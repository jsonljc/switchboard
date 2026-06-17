import type {
  IntentClass,
  TemplateCategory,
  GovernanceVerdictAction,
  GovernanceVerdictReason,
} from "@switchboard/schemas";
import type { SkillExecutionResult, SkillHook, SkillHookContext } from "../types.js";
import {
  resolveTemplate,
  type Jurisdiction,
  type TemplateApprovalOverlay,
} from "../templates/whatsapp-registry.js";
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

/**
 * Org-resolvable WhatsApp template-approval source. Returns the approval overlay
 * (metaTemplateName -> status) for a deployment so a Meta-APPROVED template can
 * actually substitute/send. Optional: when omitted, the gate uses an empty overlay,
 * which preserves the static-registry default (every template ships `draft`), so the
 * gate keeps blocking by default. A throw is treated as "no signal" (empty overlay)
 * rather than a hard error — approval status is an enrichment, not a safety gate; the
 * static default already fails closed.
 */
export interface WhatsAppTemplateApprovalSource {
  resolve: (deploymentId: string) => Promise<TemplateApprovalOverlay>;
}

export interface WhatsAppWindowGateDeps {
  verdictStore: GovernanceVerdictStore;
  handoffStore: HandoffStore;
  governanceConfigResolver: GovernanceConfigResolver;
  postureCache: WhatsAppWindowGatePostureCache;
  threadStore: { getLastWhatsAppInboundAt: (threadId: string) => Promise<Date | null> };
  contactStore: { getMessagingOptInForThread: (threadId: string) => Promise<boolean> };
  channelTypeResolver: { resolve: (sessionId: string) => Promise<string> };
  /**
   * Optional org-resolvable approval source overlaid onto the static registry.
   * Omitted → static default (draft) applies and the gate keeps blocking by default.
   */
  templateApprovalSource?: WhatsAppTemplateApprovalSource;
  clock: () => Date;
  windowMs?: number;
}

type BlockSubCause =
  | "missing_opt_in"
  | "missing_intent_class"
  | "no_template_fit"
  | "template_not_approved"
  | "marketing_substitution_blocked";

/**
 * Three-state result of resolving WhatsApp-window governance for a deployment.
 *  - "off":          no governanceConfig, or a config without a `whatsappWindow`
 *                    block → WhatsApp gating is not configured → clean no-op.
 *  - "config":       a usable posture (resolved, or recovered from the cache on error).
 *  - "unavailable":  a genuine resolver error/throw with NO cached posture → no mode
 *                    signal → fail-closed (matches the gate's deliberate 1c precedent).
 */
type WhatsAppConfigResolution =
  | { kind: "off" }
  | { kind: "config"; config: WhatsAppWindowGateConfig }
  | { kind: "unavailable" };

export class WhatsAppWindowGateHook implements SkillHook {
  readonly name = "whatsapp-window-gate";

  constructor(private readonly deps: WhatsAppWindowGateDeps) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    // Resolve config FIRST so the feature-flag check gates everything that follows.
    // If the resolver fully fails and no cached posture exists, we have no mode signal
    // and fail-closed (matching 1c precedent). If the flag is off, return immediately
    // without touching the channel resolver — preserving "default off → zero behavioral
    // change" even when the channel resolver is transiently unavailable.
    const resolution = await this.resolveConfig(ctx.deploymentId);
    if (resolution.kind === "off") {
      // No WhatsApp governance configured for this deployment (governanceConfig missing,
      // or present without a `whatsappWindow` block). Clean no-op — mirrors the three
      // sibling afterSkill gates which early-return on resolver status:"missing". THIS is
      // what makes wiring runAfterSkillHooks byte-identical for an unseeded deployment.
      return;
    }
    if (resolution.kind === "unavailable") {
      // Genuine resolver error/throw with no cached posture → no mode signal. Preserve the
      // deliberate hard-block posture (1c precedent) for an actually-erroring resolver.
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
    const config = resolution.config;
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

      // Overlay the org-resolvable approval status onto the static registry. A
      // missing source, or a throw, yields an empty overlay so the static default
      // (draft) applies and the gate keeps blocking — approval status is enrichment,
      // not a safety gate.
      const approvalOverlay = await this.resolveApprovalOverlay(ctx.deploymentId);
      const template = resolveTemplate({
        intentClass: result.intentClass,
        jurisdiction: config.jurisdiction,
        approvalOverlay,
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

  private async resolveConfig(deploymentId: string): Promise<WhatsAppConfigResolution> {
    try {
      const resolution = await this.deps.governanceConfigResolver(deploymentId);
      if (resolution.status === "missing") {
        // No governanceConfig at all → WhatsApp gating is off. Clean no-op.
        return { kind: "off" };
      }
      if (resolution.status === "error") {
        // Config present but invalid (or store error). Fail-closed only via a cached
        // posture; otherwise unavailable.
        const cached = this.deps.postureCache.lastKnown(deploymentId);
        return cached ? { kind: "config", config: cached } : { kind: "unavailable" };
      }
      const raw = resolution.config as {
        whatsappWindow?: Omit<WhatsAppWindowGateConfig, "clinicType" | "jurisdiction">;
        jurisdiction: Jurisdiction;
        clinicType: "medical" | "nonMedical";
      };
      if (!raw.whatsappWindow) {
        // A governanceConfig exists but opts out of WhatsApp-window gating → no-op.
        return { kind: "off" };
      }
      const posture: WhatsAppWindowGateConfig = {
        ...raw.whatsappWindow,
        jurisdiction: raw.jurisdiction,
        clinicType: raw.clinicType,
      };
      this.deps.postureCache.remember(deploymentId, posture);
      return { kind: "config", config: posture };
    } catch {
      const cached = this.deps.postureCache.lastKnown(deploymentId);
      return cached ? { kind: "config", config: cached } : { kind: "unavailable" };
    }
  }

  /**
   * Resolve the org-resolvable approval overlay for a deployment. Returns an empty
   * overlay when no source is wired or the source throws — the static-registry
   * default (draft) then governs, so the gate keeps blocking by default.
   */
  private async resolveApprovalOverlay(deploymentId: string): Promise<TemplateApprovalOverlay> {
    if (!this.deps.templateApprovalSource) return {};
    try {
      return await this.deps.templateApprovalSource.resolve(deploymentId);
    } catch {
      return {};
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
