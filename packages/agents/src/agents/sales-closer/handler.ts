// ---------------------------------------------------------------------------
// Sales Closer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";

export class SalesCloserHandler implements AgentHandler {
  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.qualified") {
      return { events: [], actions: [] };
    }

    const payload = validatePayload(event.payload, { contactId: "string" }, "sales-closer");
    const contactId = payload.contactId as string;
    const profile = context.profile ?? {};
    const booking = profile.booking as Record<string, unknown> | undefined;

    if (!booking) {
      return this.escalate(event, context, contactId, "no_booking_config");
    }

    const bookingUrl = booking.bookingUrl as string | undefined;
    const serviceType = (config.defaultServiceType as string) ?? "consultation";
    const durationMinutes = (config.defaultDurationMinutes as number) ?? 60;

    const conversionAction = bookingUrl ? "booking_link" : "direct_booking";

    const stageEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: {
        contactId,
        stage: "booking_initiated",
        conversionAction,
        score: payload.score,
        tier: payload.tier,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    const bookingParams: Record<string, unknown> = {
      contactId,
      serviceType,
      durationMinutes,
      sourceAdId: event.attribution?.sourceAdId,
      sourceCampaignId: event.attribution?.sourceCampaignId,
    };

    if (bookingUrl) {
      bookingParams.bookingUrl = bookingUrl;
    }

    return {
      events: [stageEvent],
      actions: [
        {
          actionType: "customer-engagement.appointment.book",
          parameters: bookingParams,
        },
      ],
      state: {
        contactId,
        conversionAction,
        stage: "booking_initiated",
      },
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
      source: { type: "agent", id: "sales-closer" },
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
