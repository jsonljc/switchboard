// ---------------------------------------------------------------------------
// Nurture Agent — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import type { NurtureAgentDeps } from "./types.js";

export class NurtureAgentHandler implements AgentHandler {
  private readonly deps: NurtureAgentDeps;

  constructor(deps: NurtureAgentDeps = {}) {
    this.deps = deps;
  }

  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    switch (event.eventType) {
      case "lead.disqualified":
        return this.handleLeadDisqualified(event, context);
      case "stage.advanced":
        return this.handleStageAdvanced(event, context);
      case "revenue.recorded":
        return this.handleRevenueRecorded(event, context);
      default:
        return { events: [], actions: [] };
    }
  }

  private handleLeadDisqualified(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;

    // Skip if contact already has an active cadence
    if (this.deps.getCadenceStatus) {
      const status = this.deps.getCadenceStatus(contactId);
      if (status?.active) {
        return { events: [], actions: [] };
      }
    }

    const events: RoutedEventEnvelope[] = [];

    // Check LTV and re-qualify if high
    if (this.deps.scoreLtv) {
      const ltv = this.deps.scoreLtv(contactId);
      if (ltv.tier === "high") {
        events.push(
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "lead.qualified",
            source: { type: "agent", id: "nurture" },
            payload: {
              contactId,
              score: ltv.score,
              tier: ltv.tier,
              reason: "high_ltv_requalification",
            },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        );
      }
    }

    return {
      events,
      actions: [
        {
          actionType: "customer-engagement.cadence.start",
          parameters: { contactId, cadenceType: "cold_nurture" },
        },
      ],
      state: { contactId, cadenceStarted: "cold_nurture" },
    };
  }

  private handleStageAdvanced(event: RoutedEventEnvelope, _context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;

    return {
      events: [],
      actions: [
        {
          actionType: "customer-engagement.reminder.send",
          parameters: { contactId, message: `Follow-up: stage advanced to ${stage}` },
        },
      ],
      state: { contactId, reminderSent: true, stage },
    };
  }

  private handleRevenueRecorded(event: RoutedEventEnvelope, _context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const platform = (payload.platform as string) ?? "google";

    return {
      events: [],
      actions: [
        {
          actionType: "customer-engagement.review.request",
          parameters: { contactId, platform },
        },
      ],
      state: { contactId, reviewRequested: true, platform },
    };
  }
}
