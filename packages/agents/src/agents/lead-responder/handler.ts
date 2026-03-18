// ---------------------------------------------------------------------------
// Lead Responder — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import type { LeadResponderDeps, ObjectionMatch } from "./types.js";

const DEFAULT_THRESHOLD = 40;

export class LeadResponderHandler implements AgentHandler {
  constructor(private deps: LeadResponderDeps) {}

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.received") {
      return { events: [], actions: [] };
    }

    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const threshold = (config.qualificationThreshold as number) ?? DEFAULT_THRESHOLD;

    // Score the lead
    const scoreResult = this.deps.scoreLead(payload);
    const qualified = scoreResult.score >= threshold;

    // Build outbound event
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

    // No action request for scoring — it's a read, already done via deps.scoreLead()
    // Only writes (booking, sending messages, etc.) produce action requests
    const actions: Array<{ actionType: string; parameters: Record<string, unknown> }> = [];

    // Handle objection if present
    const objectionText = payload.objectionText as string | undefined;
    const objectionResult = this.handleObjection(objectionText, contactId, actions);

    // Check for escalation
    const escalationEvent = this.checkEscalation(
      objectionResult,
      event,
      config,
      context,
      contactId,
    );

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
      },
    };
  }

  private handleObjection(
    objectionText: string | undefined,
    contactId: string,
    actions: Array<{ actionType: string; parameters: Record<string, unknown> }>,
  ): ObjectionMatch | undefined {
    if (!objectionText || !this.deps.matchObjection) {
      return undefined;
    }

    const match = this.deps.matchObjection(objectionText);
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
