// ---------------------------------------------------------------------------
// Sales Closer — Handler Implementation
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type {
  AgentContext,
  AgentHandler,
  AgentResponse,
  ActionRequest,
  ThreadUpdate,
} from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";
import { computeConfidence } from "../../knowledge/retrieval.js";
import { buildSalesCloserPrompt } from "./prompt-builder.js";
import type { TonePreset } from "../lead-responder/tone-presets.js";
import type { SupportedLanguage } from "../lead-responder/language-directives.js";
import type { SalesCloserDeps } from "./types.js";
import type { ConversationThread } from "@switchboard/schemas";
import { extractConversationContext } from "../../context-extractor.js";
import { refreshSummary, shouldRefreshSummary } from "../../summary-refresher.js";
import { SUMMARY_REFRESH_INTERVAL } from "@switchboard/core";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
const DEFAULT_FOLLOW_UP_DAYS = [1, 3, 7];

export class SalesCloserHandler implements AgentHandler {
  constructor(private deps: SalesCloserDeps = {}) {}

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.qualified" && event.eventType !== "message.received") {
      return { events: [], actions: [] };
    }

    // message.received with conversation deps -> LLM conversation flow
    if (event.eventType === "message.received" && this.deps.conversation) {
      return this.handleMessageReceived(event, config, context);
    }

    // lead.qualified (or message.received without deps) -> deterministic booking + cadence
    return this.handleQualified(event, config, context);
  }

  private async handleMessageReceived(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    const conv = this.deps.conversation!;
    const payload = validatePayload(
      event.payload,
      { contactId: "string", messageText: "string?" },
      "sales-closer",
    );
    const contactId = payload.contactId as string;
    const messageText = (payload.messageText as string) ?? "";
    const bookingUrl =
      (config.bookingUrl as string) ??
      ((context.profile?.booking as Record<string, unknown> | undefined)?.bookingUrl as
        | string
        | undefined) ??
      "";
    const confidenceThreshold =
      (config.confidenceThreshold as number) ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const maxTurns = (config.maxTurnsBeforeEscalation as number) ?? 10;
    const tonePreset = config.tonePreset as TonePreset | undefined;
    const language = config.language as SupportedLanguage | undefined;
    const urgencyEnabled = config.urgencyEnabled !== false;

    // 1. Retrieve conversation history
    const history = await conv.conversationStore.getHistory(contactId);

    // 2. Check max turns
    if (history.length >= maxTurns) {
      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "conversation.escalated",
            source: { type: "agent", id: "sales-closer" },
            payload: { contactId, reason: "max_turns_exceeded", turnCount: history.length },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        ],
        actions: [],
      };
    }

    // 3. Append inbound message to history
    const inboundMessage = {
      id: randomUUID(),
      contactId,
      direction: "inbound" as const,
      content: messageText,
      timestamp: new Date().toISOString(),
      channel: "whatsapp" as const,
    };
    await conv.conversationStore.appendMessage(contactId, inboundMessage);

    // 4. Retrieve relevant knowledge chunks
    const chunks = await conv.retriever.retrieve(messageText, {
      organizationId: context.organizationId,
      agentId: "sales-closer",
    });

    // 4.5. Load thread context
    const thread = (event.metadata?.conversationThread as ConversationThread) ?? undefined;
    const existingContext = thread?.agentContext ?? {
      objectionsEncountered: [],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: [],
      sentimentTrend: "unknown" as const,
    };

    // 5. Build ConversationPrompt
    const prompt = buildSalesCloserPrompt({
      history: [...history, inboundMessage],
      chunks,
      tonePreset,
      language,
      bookingUrl,
      urgencyEnabled,
      threadContext: existingContext,
    });

    // 6. Generate LLM reply
    const llmReply = await conv.llm.generateReply(prompt);

    // 7. Compute dual-signal confidence
    const bestSimilarity = chunks.length > 0 ? chunks[0]!.similarity : 0;
    const confidence = computeConfidence({
      bestSimilarity,
      llmSelfReport: llmReply.confidence,
    });

    // 8. Confidence check — escalate if below threshold
    if (confidence < confidenceThreshold) {
      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "conversation.escalated",
            source: { type: "agent", id: "sales-closer" },
            payload: {
              contactId,
              reason: "low_confidence",
              confidence,
              bestSimilarity,
              llmSelfReport: llmReply.confidence,
            },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        ],
        actions: [],
      };
    }

    // 9. Send reply via WhatsApp
    const actions: ActionRequest[] = [
      {
        actionType: "messaging.whatsapp.send",
        parameters: { contactId, content: llmReply.reply, channel: "whatsapp" },
      },
    ];

    // 10. Append outbound reply to history
    const outboundMessage = {
      id: randomUUID(),
      contactId,
      direction: "outbound" as const,
      content: llmReply.reply,
      timestamp: new Date().toISOString(),
      channel: "whatsapp" as const,
    };
    await conv.conversationStore.appendMessage(contactId, outboundMessage);

    // 11. Extract updated context
    let threadUpdate: ThreadUpdate | undefined;
    if (thread) {
      const newMessageCount = (thread.messageCount ?? 0) + 1;
      const updatedContext = await extractConversationContext(
        conv.llm,
        [...history, inboundMessage, outboundMessage],
        existingContext,
      );

      threadUpdate = {
        agentContext: updatedContext,
        messageCount: newMessageCount,
      };

      if (shouldRefreshSummary(newMessageCount, SUMMARY_REFRESH_INTERVAL)) {
        const summary = await refreshSummary(conv.llm, [
          ...history,
          inboundMessage,
          outboundMessage,
        ]);
        if (summary) {
          threadUpdate.currentSummary = summary;
        }
      }
    }

    return {
      events: [],
      actions,
      state: { contactId, confidence, reply: llmReply.reply },
      threadUpdate,
    };
  }

  private handleQualified(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
    const payload = validatePayload(event.payload, { contactId: "string" }, "sales-closer");
    const contactId = payload.contactId as string;
    const profile = context.profile ?? {};
    const booking = profile.booking as Record<string, unknown> | undefined;

    if (!booking) {
      return this.escalate(event, context, contactId, "no_booking_config");
    }

    const bookingUrl =
      (config.bookingUrl as string) ?? (booking.bookingUrl as string | undefined) ?? "";
    const followUpDays = (config.followUpDays as number[]) ?? DEFAULT_FOLLOW_UP_DAYS;

    const stageEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: {
        contactId,
        stage: "booking_initiated",
        conversionAction: bookingUrl ? "booking_link" : "direct_booking",
        score: payload.score,
        tier: payload.tier,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    const actions: ActionRequest[] = [];

    // Delegate follow-up cadence to Nurture if active, otherwise fallback
    const nurtureActive = this.deps.isAgentActive?.(context.organizationId, "nurture") ?? false;

    if (nurtureActive) {
      actions.push({
        actionType: "customer-engagement.cadence.start",
        parameters: {
          contactId,
          cadenceType: "sales-followup",
          config: { followUpDays, bookingUrl },
        },
      });
    } else {
      // Minimal fallback: re-send booking link directly
      actions.push({
        actionType: "messaging.whatsapp.send",
        parameters: {
          contactId,
          content: bookingUrl
            ? `Ready to book? Here's your link: ${bookingUrl}`
            : "Reply to confirm your booking and we'll get you scheduled!",
          channel: "whatsapp",
        },
      });
    }

    return {
      events: [stageEvent],
      actions,
      state: { contactId, stage: "booking_initiated", nurtureActive },
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
          source: { type: "agent", id: "sales-closer" },
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
