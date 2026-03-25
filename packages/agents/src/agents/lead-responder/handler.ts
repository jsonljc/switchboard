// ---------------------------------------------------------------------------
// Lead Responder — Handler Implementation
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse, ActionRequest } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";
import { computeConfidence } from "../../knowledge/retrieval.js";
import { buildConversationPrompt } from "./prompt-builder.js";
import type { TonePreset } from "./tone-presets.js";
import type { SupportedLanguage } from "./language-directives.js";
import type { LeadResponderDeps, ObjectionMatch } from "./types.js";
import type { ConversationThread, OpportunityStage } from "@switchboard/schemas";
import { extractConversationContext } from "../../context-extractor.js";
import { refreshSummary, shouldRefreshSummary } from "../../summary-refresher.js";
import { SUMMARY_REFRESH_INTERVAL } from "@switchboard/core";
import type { ThreadUpdate } from "../../ports.js";

const DEFAULT_THRESHOLD = 40;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export class LeadResponderHandler implements AgentHandler {
  constructor(private deps: LeadResponderDeps) {}

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.received" && event.eventType !== "message.received") {
      return { events: [], actions: [] };
    }

    // message.received with conversation deps -> LLM conversation flow
    if (event.eventType === "message.received" && this.deps.conversation) {
      return this.handleMessageReceived(event, config, context);
    }

    // lead.received (or message.received without conversation deps) -> scoring-only flow
    return this.handleLeadScoring(event, config, context);
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
      "lead-responder",
    );
    const contactId = payload.contactId as string;
    const messageText = (payload.messageText as string) ?? "";
    const threshold = (config.qualificationThreshold as number) ?? DEFAULT_THRESHOLD;
    const confidenceThreshold =
      (config.confidenceThreshold as number) ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const maxTurns = (config.maxTurnsBeforeEscalation as number) ?? 10;
    const tonePreset = config.tonePreset as TonePreset | undefined;
    const language = config.language as SupportedLanguage | undefined;
    const bookingLink = config.bookingLink as string | undefined;
    const mode = (config.mode as string) ?? "active";
    const testMode = mode === "test" || mode === "draft";
    const channel = testMode ? "dashboard" : "whatsapp";

    // 1. Retrieve conversation history
    const history = await conv.conversationStore.getHistory(contactId);

    // 2. Check max turns
    if (history.length >= maxTurns) {
      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "conversation.escalated",
            source: { type: "agent", id: "lead-responder" },
            payload: {
              contactId,
              reason: "max_turns_exceeded",
              turnCount: history.length,
            },
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
      channel: channel as "whatsapp" | "dashboard",
    };
    await conv.conversationStore.appendMessage(contactId, inboundMessage);

    // 4. Retrieve relevant knowledge chunks
    const chunks = await conv.retriever.retrieve(messageText, {
      organizationId: context.organizationId,
      agentId: "lead-responder",
    });

    // 4.5. Read opportunity stage from event metadata (if available)
    const opportunityStage = event.metadata?.opportunityStage as OpportunityStage | undefined;

    // 4.6. Load thread context from event metadata
    const thread = (event.metadata?.conversationThread as ConversationThread) ?? undefined;
    const existingContext = thread?.agentContext ?? {
      objectionsEncountered: [],
      preferencesLearned: {},
      offersMade: [],
      topicsDiscussed: [],
      sentimentTrend: "unknown" as const,
    };

    // 5. Build ConversationPrompt
    const prompt = buildConversationPrompt({
      history: [...history, inboundMessage],
      chunks,
      tonePreset,
      language,
      bookingLink,
      testMode,
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

    const events: RoutedEventEnvelope[] = [];
    const actions: ActionRequest[] = [];

    // 8. Confidence check — escalate if below threshold
    if (confidence < confidenceThreshold) {
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "conversation.escalated",
          source: { type: "agent", id: "lead-responder" },
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
      );

      return { events, actions };
    }

    // 9. Score lead for qualification signals
    const scoreResult = this.deps.scoreLead(payload as Record<string, unknown>);
    const qualified = scoreResult.score >= threshold;

    if (qualified) {
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "lead.qualified",
          source: { type: "agent", id: "lead-responder" },
          payload: {
            contactId,
            score: scoreResult.score,
            tier: scoreResult.tier,
            factors: scoreResult.factors,
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      );

      // Emit opportunity stage advancement when qualification completes
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "opportunity.stage_advanced",
          source: { type: "agent", id: "lead-responder" },
          payload: {
            contactId,
            previousStage: opportunityStage ?? "interested",
            newStage: "qualified",
            reason: "qualification_complete",
            score: scoreResult.score,
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      );

      // Transition stage
      await conv.conversationStore.setStage(contactId, "qualified");
    } else {
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "lead.disqualified",
          source: { type: "agent", id: "lead-responder" },
          payload: {
            contactId,
            score: scoreResult.score,
            tier: scoreResult.tier,
            factors: scoreResult.factors,
            reason: "below_threshold",
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      );
    }

    // 10. Send reply (skip in test mode — dashboard shows it directly)
    if (!testMode) {
      actions.push({
        actionType: "messaging.whatsapp.send",
        parameters: {
          contactId,
          content: llmReply.reply,
          channel: "whatsapp",
        },
      });
    }

    // 11. Append outbound reply to history
    const outboundMessage = {
      id: randomUUID(),
      contactId,
      direction: "outbound" as const,
      content: llmReply.reply,
      timestamp: new Date().toISOString(),
      channel: channel as "whatsapp" | "dashboard",
    };
    await conv.conversationStore.appendMessage(contactId, outboundMessage);

    // 12. Extract updated context (non-blocking, best-effort)
    let threadUpdate: ThreadUpdate | undefined;
    if (thread) {
      const newMessageCount = (thread.messageCount ?? 0) + 1;
      const updatedContext = await extractConversationContext(
        conv.llm,
        [...history, inboundMessage, outboundMessage],
        existingContext,
      );

      threadUpdate = {
        stage: qualified ? "qualified" : thread.stage === "new" ? "responding" : thread.stage,
        agentContext: updatedContext,
        messageCount: newMessageCount,
      };

      // 13. Refresh summary if at interval
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
      events,
      actions,
      state: {
        lastScore: scoreResult.score,
        lastTier: scoreResult.tier,
        qualified,
        confidence,
        reply: llmReply.reply,
      },
      threadUpdate,
    };
  }

  private handleLeadScoring(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { contactId: "string", objectionText: "string?", messageText: "string?" },
      "lead-responder",
    );
    const contactId = payload.contactId as string;
    const threshold = (config.qualificationThreshold as number) ?? DEFAULT_THRESHOLD;

    let scoreResult;
    try {
      scoreResult = this.deps.scoreLead(payload);
    } catch (err) {
      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "conversation.escalated",
            source: { type: "agent", id: "lead-responder" },
            payload: {
              contactId,
              reason: "scoring_error",
              error: err instanceof Error ? err.message : String(err),
            },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        ],
        actions: [],
      };
    }
    const qualified = scoreResult.score >= threshold;

    const outboundEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: qualified ? "lead.qualified" : "lead.disqualified",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId,
        score: scoreResult.score,
        tier: scoreResult.tier,
        factors: scoreResult.factors,
        ...(qualified ? {} : { reason: "below_threshold" }),
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    const actions: ActionRequest[] = [];

    const objectionText = payload.objectionText as string | undefined;
    const objectionResult = this.handleObjection(objectionText, contactId, actions);

    const escalationEvent = this.checkEscalation(
      objectionResult,
      event,
      config,
      context,
      contactId,
    );

    const messageText = payload.messageText as string | undefined;
    let faqResponse: string | undefined;
    if (messageText && this.deps.matchFAQ) {
      try {
        const faqResult = this.deps.matchFAQ(messageText);
        if (faqResult.matched) {
          faqResponse = faqResult.answer;
        }
      } catch {
        // skip FAQ matching on error — non-critical
      }
    }

    const events: RoutedEventEnvelope[] = [outboundEvent];
    if (escalationEvent) {
      events.push(escalationEvent);
    }

    return {
      events,
      actions,
      state: {
        lastScore: scoreResult.score,
        lastTier: scoreResult.tier,
        qualified,
        ...(faqResponse ? { faqResponse } : {}),
      },
    };
  }

  private handleObjection(
    objectionText: string | undefined,
    contactId: string,
    actions: ActionRequest[],
  ): ObjectionMatch | undefined {
    if (!objectionText || !this.deps.matchObjection) {
      return undefined;
    }

    let match: ObjectionMatch;
    try {
      match = this.deps.matchObjection(objectionText);
    } catch {
      return undefined;
    }
    actions.push({
      actionType: "customer-engagement.conversation.handle_objection",
      parameters: { contactId, objectionText },
    });

    return match;
  }

  private checkEscalation(
    objectionResult: ObjectionMatch | undefined,
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
    contactId: string,
  ): RoutedEventEnvelope | undefined {
    const shouldEscalate = objectionResult !== undefined && !objectionResult.matched;

    const turnCount = context.conversationHistory?.length ?? 0;
    const maxTurns = (config.maxTurnsBeforeEscalation as number) ?? 10;
    const tooManyTurns = turnCount >= maxTurns;

    if (!shouldEscalate && !tooManyTurns) {
      return undefined;
    }

    return createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "conversation.escalated",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId,
        reason: shouldEscalate ? "unmatched_objection" : "max_turns_exceeded",
        turnCount,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });
  }
}
