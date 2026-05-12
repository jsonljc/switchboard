import type {
  IntentClass,
  TemplateCategory,
  GovernanceVerdictAction,
  GovernanceVerdictReason,
} from "@switchboard/schemas";
import type { SkillExecutionResult, SkillHook, SkillHookContext } from "../types.js";
import { selectTemplate, type Jurisdiction } from "../templates/whatsapp-registry.js";
import type { HandoffStore } from "../../handoff/types.js";
import { buildHandoffPackage } from "../../handoff/build-handoff-package.js";
import type { GovernanceVerdictStore } from "../../governance/governance-verdict-store/types.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppWindowGateConfig {
  enabled: boolean;
  mode: "observe" | "enforce";
  jurisdiction: Jurisdiction;
  clinicType: "medical" | "nonMedical";
  /**
   * If false (default in 1d), marketing-category templates are blocked + handed off
   * even when a match exists. Prevents 1d from silently becoming a paid promotional
   * sender. Phase 2 operator approval queue / budget caps are the natural enablement
   * layer for flipping this to true per deployment.
   */
  allowMarketingTemplateSubstitution: boolean;
}

export interface WhatsAppWindowGatePostureCache {
  lastKnown: (deploymentId: string) => WhatsAppWindowGateConfig | undefined;
  remember: (deploymentId: string, posture: WhatsAppWindowGateConfig) => void;
}

export interface WhatsAppWindowGateDeps {
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: WhatsAppWindowGatePostureCache;
  threadStore: { getLastWhatsAppInboundAt: (threadId: string) => Promise<Date | null> };
  contactStore: { getMessagingOptInForThread: (threadId: string) => Promise<boolean> };
  channelTypeResolver: { resolve: (sessionId: string) => Promise<string> };
  clock: () => Date;
  windowMs?: number;
}

type BlockSubCause =
  | "missing_opt_in"
  | "missing_intent_class"
  | "no_template_fit"
  | "template_not_approved"
  | "marketing_substitution_blocked";

export class WhatsAppWindowGateHook implements SkillHook {
  readonly name = "whatsapp-window-gate";

  constructor(private readonly deps: WhatsAppWindowGateDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    // Resolve config FIRST so the feature-flag check gates everything that follows.
    // If the resolver fully fails and no cached posture exists, we have no mode signal
    // and fail-closed (matching 1c precedent). If the flag is off, return immediately
    // without touching the channel resolver — preserving "default off → zero behavioral
    // change" even when the channel resolver is transiently unavailable.
    const config = await this.resolveConfig(ctx.deploymentId);
    if (!config) {
      // Fail-closed: governance is unavailable. Match 1c's precedent — block hard.
      await this.emitVerdict({
        ctx,
        action: "block",
        reasonCode: "governance_unavailable",
        jurisdiction: "SG",
        clinicType: "medical",
        auditLevel: "critical",
        details: { reason: "resolver_error" },
      });
      result.response = "";
      return;
    }
    if (!config.enabled) return;

    // Channel resolution AFTER the flag check. Now that we have config, a throw here
    // can properly respect config.mode for the blanking decision.
    let channel: string;
    try {
      channel = await this.deps.channelTypeResolver.resolve(ctx.sessionId);
    } catch {
      await this.emitVerdict({
        ctx,
        action: "block",
        reasonCode: "governance_unavailable",
        jurisdiction: config.jurisdiction,
        clinicType: config.clinicType,
        auditLevel: "critical",
        details: { reason: "storage_error" },
      });
      if (config.mode === "enforce") {
        result.response = "";
      }
      return;
    }
    if (channel !== "whatsapp") return;

    try {
      const lastInbound = await this.deps.threadStore.getLastWhatsAppInboundAt(ctx.sessionId);
      const now = this.deps.clock().getTime();
      const windowMs = this.deps.windowMs ?? DEFAULT_WINDOW_MS;
      const inside = lastInbound !== null && now - lastInbound.getTime() < windowMs;

      if (inside) {
        await this.emitVerdict({
          ctx,
          action: "allow",
          reasonCode: "allowed",
          jurisdiction: config.jurisdiction,
          clinicType: config.clinicType,
          auditLevel: "info",
          details: { windowStatus: "inside", lastWhatsAppInboundAt: lastInbound?.toISOString() },
        });
        return;
      }

      const optIn = await this.deps.contactStore.getMessagingOptInForThread(ctx.sessionId);
      if (!optIn) {
        await this.handleBlock(ctx, result, config, {
          subCause: "missing_opt_in",
          intentClass: result.intentClass ?? null,
          templateMetadata: null,
          details: {
            windowStatus: "outside",
            optInStatus: "missing_or_false",
            templateMatch: "not_attempted",
            intentClass: result.intentClass ?? null,
          },
        });
        return;
      }

      if (!result.intentClass) {
        await this.handleBlock(ctx, result, config, {
          subCause: "missing_intent_class",
          intentClass: null,
          templateMetadata: null,
          details: {
            windowStatus: "outside",
            optInStatus: "granted",
            templateMatch: "skipped_no_intent",
            intentClass: null,
          },
        });
        return;
      }

      const template = selectTemplate({
        intentClass: result.intentClass,
        jurisdiction: config.jurisdiction,
      });
      if (!template) {
        await this.handleBlock(ctx, result, config, {
          subCause: "no_template_fit",
          intentClass: result.intentClass,
          templateMetadata: null,
          details: {
            windowStatus: "outside",
            optInStatus: "granted",
            templateMatch: "no_fit",
            intentClass: result.intentClass,
          },
        });
        return;
      }

      if (template.approvalStatus !== "approved") {
        await this.handleBlock(ctx, result, config, {
          subCause: "template_not_approved",
          intentClass: result.intentClass,
          templateMetadata: {
            templateName: template.name,
            metaTemplateName: template.metaTemplateName,
            templateCategory: template.templateCategory,
          },
          details: {
            windowStatus: "outside",
            optInStatus: "granted",
            templateMatch: "template_not_approved",
            intentClass: result.intentClass,
            templateName: template.name,
            metaTemplateName: template.metaTemplateName,
            approvalStatus: template.approvalStatus,
          },
        });
        return;
      }

      if (template.templateCategory === "marketing" && !config.allowMarketingTemplateSubstitution) {
        await this.handleBlock(ctx, result, config, {
          subCause: "marketing_substitution_blocked",
          intentClass: result.intentClass,
          templateMetadata: {
            templateName: template.name,
            metaTemplateName: template.metaTemplateName,
            templateCategory: template.templateCategory,
          },
          details: {
            windowStatus: "outside",
            optInStatus: "granted",
            templateMatch: "marketing_substitution_blocked",
            intentClass: result.intentClass,
            templateName: template.name,
            metaTemplateName: template.metaTemplateName,
            templateCategory: template.templateCategory,
            recipientMarket: config.jurisdiction,
            costRisk: "paid_template_message",
            costEstimateStatus: "not_priced_in_1d",
          },
        });
        return;
      }

      // Happy path: substitute with template.
      const originalText = result.response;
      if (config.mode === "enforce") {
        result.response = template.body;
      }
      await this.emitVerdict({
        ctx,
        action: "template_required",
        reasonCode: "outside_whatsapp_window",
        jurisdiction: config.jurisdiction,
        clinicType: config.clinicType,
        auditLevel: "warning",
        originalText,
        emittedText: template.body,
        details: {
          windowStatus: "outside",
          optInStatus: "granted",
          templateMatch: "matched",
          intentClass: result.intentClass,
          templateName: template.name,
          metaTemplateName: template.metaTemplateName,
          templateCategory: template.templateCategory,
          recipientMarket: config.jurisdiction,
          costRisk: "paid_template_message",
          costEstimateStatus: "not_priced_in_1d",
        },
      });
    } catch {
      await this.emitVerdict({
        ctx,
        action: "block",
        reasonCode: "governance_unavailable",
        jurisdiction: config.jurisdiction,
        clinicType: config.clinicType,
        auditLevel: "critical",
        details: { reason: "storage_error" },
      });
      if (config.mode === "enforce") {
        result.response = "";
      }
    }
  }

  private async resolveConfig(deploymentId: string): Promise<WhatsAppWindowGateConfig | null> {
    try {
      const resolution = await this.deps.governanceConfigResolver(deploymentId);
      if (resolution.status !== "resolved") return null;
      const raw = resolution.config as {
        whatsappWindow?: Omit<WhatsAppWindowGateConfig, "clinicType" | "jurisdiction">;
        jurisdiction: Jurisdiction;
        clinicType: "medical" | "nonMedical";
      };
      if (!raw.whatsappWindow) return null;
      const posture: WhatsAppWindowGateConfig = {
        ...raw.whatsappWindow,
        jurisdiction: raw.jurisdiction,
        clinicType: raw.clinicType,
      };
      this.deps.postureCache.remember(deploymentId, posture);
      return posture;
    } catch {
      const cached = this.deps.postureCache.lastKnown(deploymentId);
      return cached ?? null;
    }
  }

  private async handleBlock(
    ctx: SkillHookContext,
    result: SkillExecutionResult,
    config: WhatsAppWindowGateConfig,
    args: {
      subCause: BlockSubCause;
      intentClass: IntentClass | null;
      templateMetadata: {
        templateName: string;
        metaTemplateName: string;
        templateCategory: TemplateCategory;
      } | null;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    const originalText = result.response;
    if (config.mode === "enforce") {
      result.response = "";
      const pkg = buildHandoffPackage(ctx.sessionId, ctx.orgId, 0, this.deps.clock);
      await this.deps.handoffStore.save({
        ...pkg,
        reason: "outside_whatsapp_window",
      });
    }
    await this.emitVerdict({
      ctx,
      action: "block",
      reasonCode: "outside_whatsapp_window",
      jurisdiction: config.jurisdiction,
      clinicType: config.clinicType,
      auditLevel: "critical",
      originalText,
      details: args.details,
    });
  }

  private async emitVerdict(args: {
    ctx: SkillHookContext;
    action: GovernanceVerdictAction;
    reasonCode: GovernanceVerdictReason;
    jurisdiction: Jurisdiction;
    clinicType: "medical" | "nonMedical";
    auditLevel: "info" | "warning" | "critical";
    originalText?: string;
    emittedText?: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    // details is contextual metadata logged elsewhere; GovernanceVerdictStore.save
    // accepts only the structured GovernanceVerdictDetails subset (matchCategory etc.).
    // The broader details object is passed for call-site clarity but not persisted here.
    void args.details;
    await this.deps.verdictStore.save({
      sourceGuard: "whatsapp_window",
      action: args.action,
      reasonCode: args.reasonCode,
      jurisdiction: args.jurisdiction,
      clinicType: args.clinicType,
      auditLevel: args.auditLevel,
      deploymentId: args.ctx.deploymentId,
      conversationId: args.ctx.sessionId,
      originalText: args.originalText,
      emittedText: args.emittedText,
      decidedAt: this.deps.clock().toISOString(),
    });
  }
}
