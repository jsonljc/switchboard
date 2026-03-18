// ---------------------------------------------------------------------------
// Sales Closer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import type { SalesCloserDeps } from "./types.js";

export class SalesCloserHandler implements AgentHandler {
  private readonly deps: SalesCloserDeps;

  constructor(deps: SalesCloserDeps = {}) {
    this.deps = deps;
  }

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.qualified") {
      return { events: [], actions: [] };
    }

    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const profile = context.profile ?? {};
    const booking = profile.booking as Record<string, unknown> | undefined;

    // If no booking config, escalate — needs human to configure
    if (!booking) {
      return this.escalate(event, context, contactId, "no_booking_config");
    }

    const bookingUrl = booking.bookingUrl as string | undefined;
    const serviceType = (config.defaultServiceType as string) ?? "consultation";
    const durationMinutes = (config.defaultDurationMinutes as number) ?? 60;

    const conversionAction = bookingUrl ? "booking_link" : "direct_booking";

    // Check availability if dep provided
    let availableSlots: number | undefined;
    if (this.deps.getAvailableSlots) {
      const slots = await this.deps.getAvailableSlots({ serviceType, durationMinutes });
      availableSlots = slots.length;
      if (slots.length === 0) {
        return this.escalate(event, context, contactId, "no_available_slots");
      }
    }

    // Emit stage.advanced
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

    // Build booking action request
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

    const actions = [
      {
        actionType: "customer-engagement.appointment.book",
        parameters: bookingParams,
      },
    ];

    return {
      events: [stageEvent],
      actions,
      state: {
        contactId,
        conversionAction,
        stage: "booking_initiated",
        ...(availableSlots !== undefined && { availableSlots }),
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
