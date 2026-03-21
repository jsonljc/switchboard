// ---------------------------------------------------------------------------
// Nurture Agent — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse, ActionRequest } from "../../ports.js";
import { canRequalify, type LifecycleStage } from "../../lifecycle.js";
import { validatePayload } from "../../validate-payload.js";
import { getCadenceConfig } from "./cadence-types.js";
import { buildNurturePrompt } from "./prompt-builder.js";
import type { TonePreset } from "../lead-responder/tone-presets.js";
import type { SupportedLanguage } from "../lead-responder/language-directives.js";
import type { NurtureDeps } from "./types.js";

const STAGE_TO_CADENCE: Record<string, string> = {
  booking_initiated: "consultation-reminder",
  service_completed: "post-treatment-review",
  no_show: "no-show-recovery",
  dormant: "dormant-client",
};

export class NurtureAgentHandler implements AgentHandler {
  constructor(private deps: NurtureDeps = {}) {}

  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "stage.advanced") {
      return this.handleStageAdvanced(event, context);
    }

    if (event.eventType === "lead.disqualified") {
      return this.handleDisqualified(event, context);
    }

    if (event.eventType === "revenue.recorded") {
      return this.handleRevenueRecorded(event, context);
    }

    return { events: [], actions: [] };
  }

  private async handleStageAdvanced(
    event: RoutedEventEnvelope,
    context: AgentContext,
  ): Promise<AgentResponse> {
    const payload = validatePayload(
      event.payload,
      { contactId: "string", stage: "string" },
      "nurture",
    );
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;
    const profile = context.profile ?? {};
    const nurture = profile.nurture as Record<string, unknown> | undefined;

    if (!nurture) {
      return this.escalate(event, context, contactId, "no_nurture_config");
    }

    const cadenceType = STAGE_TO_CADENCE[stage];
    if (!cadenceType) {
      return this.escalate(event, context, contactId, "unknown_nurture_stage");
    }

    const enabledCadences = nurture.enabledCadences as string[] | undefined;
    if (enabledCadences && !enabledCadences.includes(cadenceType)) {
      return this.escalate(event, context, contactId, "cadence_not_enabled");
    }

    return this.executeCadence(event, context, contactId, cadenceType, nurture);
  }

  private async handleRevenueRecorded(
    event: RoutedEventEnvelope,
    context: AgentContext,
  ): Promise<AgentResponse> {
    const payload = validatePayload(event.payload, { contactId: "string" }, "nurture");
    const contactId = payload.contactId as string;
    const profile = context.profile ?? {};
    const nurture = profile.nurture as Record<string, unknown> | undefined;

    if (!nurture) {
      return this.escalate(event, context, contactId, "no_nurture_config");
    }

    const enabledCadences = nurture.enabledCadences as string[] | undefined;
    if (enabledCadences && !enabledCadences.includes("post-treatment-review")) {
      return { events: [], actions: [] };
    }

    return this.executeCadence(event, context, contactId, "post-treatment-review", nurture);
  }

  private handleDisqualified(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { contactId: "string", requalify: "boolean?" },
      "nurture",
    );
    const contactId = payload.contactId as string;
    const requalify = payload.requalify as boolean | undefined;
    const profile = context.profile ?? {};
    const nurture = profile.nurture as Record<string, unknown> | undefined;

    if (!nurture) {
      return this.escalate(event, context, contactId, "no_nurture_config");
    }

    if (requalify) {
      const lifecycleStage = context.contactData?.lifecycleStage as LifecycleStage | undefined;
      if (!canRequalify(lifecycleStage)) {
        return this.escalate(event, context, contactId, "requalify_blocked_by_lifecycle");
      }

      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "lead.qualified",
            source: { type: "agent", id: "nurture" },
            payload: { contactId, requalifiedFrom: "dormant" },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        ],
        actions: [],
        state: { contactId, requalified: true },
      };
    }

    return {
      events: [],
      actions: [
        {
          actionType: "customer-engagement.cadence.start",
          parameters: { contactId, cadenceId: "cold-nurture" },
        },
      ],
      state: { contactId, cadenceId: "cold-nurture" },
    };
  }

  private async executeCadence(
    event: RoutedEventEnvelope,
    context: AgentContext,
    contactId: string,
    cadenceType: string,
    nurtureConfig: Record<string, unknown>,
  ): Promise<AgentResponse> {
    // Opt-out check
    if (this.deps.conversation) {
      const optedOut = await this.deps.conversation.conversationStore.isOptedOut(contactId);
      if (optedOut) {
        return {
          events: [],
          actions: [],
          state: { contactId, cadenceType, skippedReason: "opted_out" },
        };
      }
    }

    const cadenceConfig = getCadenceConfig(cadenceType);
    if (!cadenceConfig) {
      return this.escalate(event, context, contactId, "unknown_cadence_type");
    }

    const tonePreset = nurtureConfig.tonePreset as TonePreset | undefined;
    const language = nurtureConfig.language as SupportedLanguage | undefined;
    const reviewPlatformLink = nurtureConfig.reviewPlatformLink as string | undefined;
    const firstStep = cadenceConfig.steps[0]!;

    // Generate message content — LLM or fallback
    let messageContent: string;

    if (this.deps.conversation) {
      const chunks = await this.deps.conversation.retriever.retrieve(firstStep.templateKey, {
        organizationId: context.organizationId,
        agentId: "nurture",
      });

      const history = await this.deps.conversation.conversationStore.getHistory(contactId);

      const prompt = buildNurturePrompt({
        history,
        chunks,
        tonePreset,
        language,
        cadenceType,
        templateKey: firstStep.templateKey,
        reviewPlatformLink,
      });

      const llmReply = await this.deps.conversation.llm.generateReply(prompt);
      messageContent = llmReply.reply;
    } else {
      messageContent = firstStep.fallbackMessage;
      if (reviewPlatformLink && cadenceType === "post-treatment-review") {
        messageContent += ` ${reviewPlatformLink}`;
      }
    }

    const actions: ActionRequest[] = [
      {
        actionType: "messaging.whatsapp.send",
        parameters: {
          contactId,
          content: messageContent,
          channel: "whatsapp",
        },
      },
    ];

    return {
      events: [],
      actions,
      state: { contactId, cadenceType, step: firstStep.templateKey },
    };
  }

  private escalate(
    event: RoutedEventEnvelope,
    context: AgentContext,
    contactId: string,
    reason: string,
  ): AgentResponse {
    return {
      events: [
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "conversation.escalated",
          source: { type: "agent", id: "nurture" },
          payload: { contactId, reason },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      ],
      actions: [],
    };
  }
}
