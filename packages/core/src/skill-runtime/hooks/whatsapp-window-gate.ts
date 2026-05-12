import type { IntentClass } from "@switchboard/schemas";
import type { SkillExecutionResult, SkillHook, SkillHookContext } from "../types.js";
import { selectTemplate, type Jurisdiction } from "../templates/whatsapp-registry.js";
import type { HandoffReason } from "../../handoff/types.js";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppWindowGateConfig {
  enabled: boolean;
  mode: "observe" | "enforce";
  jurisdiction: Jurisdiction;
  /**
   * If false (default in 1d), marketing-category templates are blocked + handed off
   * even when a match exists. Prevents 1d from silently becoming a paid promotional
   * sender. Phase 2 operator approval queue / budget caps are the natural enablement
   * layer for flipping this to true per deployment.
   */
  allowMarketingTemplateSubstitution: boolean;
}

export interface WhatsAppWindowGateDeps {
  verdictStore: { save: (input: unknown) => Promise<void> };
  handoffStore: { save: (input: unknown) => Promise<void> };
  governanceConfigResolver: {
    resolve: (deploymentId: string) => Promise<{
      whatsappWindow?: WhatsAppWindowGateConfig;
    }>;
  };
  postureCache: {
    get: (deploymentId: string) => WhatsAppWindowGateConfig | undefined;
    remember: (deploymentId: string, posture: WhatsAppWindowGateConfig) => void;
  };
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
    const channel = await this.deps.channelTypeResolver.resolve(ctx.sessionId);
    if (channel !== "whatsapp") return;

    const config = await this.resolveConfig(ctx.deploymentId);
    if (!config) {
      // Fail-closed: governance is unavailable. Match 1c's precedent — block hard.
      await this.emitVerdict({
        ctx,
        action: "block",
        reasonCode: "governance_unavailable",
        details: { reason: "resolver_error" },
      });
      result.response = "";
      return;
    }
    if (!config.enabled) return;

    const lastInbound = await this.deps.threadStore.getLastWhatsAppInboundAt(ctx.sessionId);
    const now = this.deps.clock().getTime();
    const windowMs = this.deps.windowMs ?? DEFAULT_WINDOW_MS;
    const inside = lastInbound !== null && now - lastInbound.getTime() < windowMs;

    if (inside) {
      await this.emitVerdict({
        ctx,
        action: "allow",
        reasonCode: "allowed",
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

    // Happy path: substitute.
    const originalText = result.response;
    if (config.mode === "enforce") {
      result.response = template.body;
    }
    await this.emitVerdict({
      ctx,
      action: "substitute",
      reasonCode: "outside_whatsapp_window",
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
  }

  private async resolveConfig(deploymentId: string): Promise<WhatsAppWindowGateConfig | null> {
    try {
      const cfg = await this.deps.governanceConfigResolver.resolve(deploymentId);
      const posture = cfg.whatsappWindow ?? null;
      if (posture) this.deps.postureCache.remember(deploymentId, posture);
      return posture;
    } catch {
      const cached = this.deps.postureCache.get(deploymentId);
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
        templateCategory: "utility" | "marketing" | "authentication";
      } | null;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    const originalText = result.response;
    if (config.mode === "enforce") {
      result.response = "";
      const handoffReason: HandoffReason = "outside_whatsapp_window";
      await this.deps.handoffStore.save({
        reason: handoffReason,
        conversationId: ctx.sessionId,
        originalText,
        metadata: {
          intentClass: args.intentClass,
          blockSubCause: args.subCause,
          jurisdiction: config.jurisdiction,
          ...(args.templateMetadata ?? {}),
        },
      });
    }
    await this.emitVerdict({
      ctx,
      action: "block",
      reasonCode: "outside_whatsapp_window",
      originalText,
      details: args.details,
    });
  }

  private async emitVerdict(args: {
    ctx: SkillHookContext;
    action: "allow" | "block" | "substitute";
    reasonCode: string;
    originalText?: string;
    emittedText?: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.deps.verdictStore.save({
      sourceGuard: "whatsapp_window",
      action: args.action,
      reasonCode: args.reasonCode,
      deploymentId: args.ctx.deploymentId,
      conversationId: args.ctx.sessionId,
      originalText: args.originalText,
      emittedText: args.emittedText,
      decidedAt: this.deps.clock().toISOString(),
      details: args.details,
    });
  }
}
