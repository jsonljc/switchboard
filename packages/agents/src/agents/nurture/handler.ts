// ---------------------------------------------------------------------------
// Nurture Agent — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";

const STAGE_TO_CADENCE: Record<string, string> = {
  booking_initiated: "consultation-reminder",
  service_completed: "post-treatment-followup",
  no_show: "no-show-rebook",
  dormant: "dormant-winback",
};

export class NurtureAgentHandler implements AgentHandler {
  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "stage.advanced") {
      const payload = event.payload as Record<string, unknown>;
      const contactId = payload.contactId as string;
      const stage = payload.stage as string;
      const profile = context.profile ?? {};
      const nurture = profile.nurture as Record<string, unknown> | undefined;

      if (!nurture) {
        return this.escalate(event, context, contactId, "no_nurture_config");
      }

      const cadenceId = STAGE_TO_CADENCE[stage];
      if (!cadenceId) {
        return this.escalate(event, context, contactId, "unknown_nurture_stage");
      }

      const enabledCadences = nurture.enabledCadences as string[] | undefined;
      if (enabledCadences && !enabledCadences.includes(cadenceId)) {
        return this.escalate(event, context, contactId, "cadence_not_enabled");
      }

      return {
        events: [],
        actions: [
          {
            actionType: "customer-engagement.cadence.start",
            parameters: { contactId, cadenceId },
          },
        ],
        state: {
          contactId,
          stage,
          cadenceId,
        },
      };
    }

    if (event.eventType === "lead.disqualified") {
      return this.handleDisqualified(event, context);
    }

    if (event.eventType === "revenue.recorded") {
      return this.handleRevenueRecorded(event, context);
    }

    return { events: [], actions: [] };
  }

  private handleRevenueRecorded(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const profile = context.profile ?? {};
    const nurture = profile.nurture as Record<string, unknown> | undefined;

    if (!nurture) {
      return this.escalate(event, context, contactId, "no_nurture_config");
    }

    const reviewDelayDays = (nurture.reviewDelayDays as number) ?? 7;
    const enabledCadences = nurture.enabledCadences as string[] | undefined;

    if (enabledCadences && !enabledCadences.includes("post-purchase-review")) {
      return { events: [], actions: [] };
    }

    return {
      events: [],
      actions: [
        {
          actionType: "customer-engagement.cadence.start",
          parameters: {
            contactId,
            cadenceId: "post-purchase-review",
            delayDays: reviewDelayDays,
          },
        },
      ],
      state: { contactId, cadenceId: "post-purchase-review", reviewDelayDays },
    };
  }

  private handleDisqualified(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const requalify = payload.requalify as boolean | undefined;
    const profile = context.profile ?? {};
    const nurture = profile.nurture as Record<string, unknown> | undefined;

    if (!nurture) {
      return this.escalate(event, context, contactId, "no_nurture_config");
    }

    if (requalify) {
      const requalEvent = createEventEnvelope({
        organizationId: context.organizationId,
        eventType: "lead.qualified",
        source: { type: "agent", id: "nurture" },
        payload: { contactId, requalifiedFrom: "dormant" },
        correlationId: event.correlationId,
        causationId: event.eventId,
        attribution: event.attribution,
      });

      return {
        events: [requalEvent],
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

  private escalate(
    event: RoutedEventEnvelope,
    context: AgentContext,
    contactId: string,
    reason: string,
  ): AgentResponse {
    const escalationEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "conversation.escalated",
      source: { type: "agent", id: "nurture" },
      payload: {
        contactId,
        reason,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [escalationEvent],
      actions: [],
    };
  }
}
