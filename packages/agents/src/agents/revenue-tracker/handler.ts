// ---------------------------------------------------------------------------
// Revenue Tracker — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { ActionRequest, AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import type { RevenueTrackerDeps } from "./types.js";

export class RevenueTrackerHandler implements AgentHandler {
  private readonly deps: RevenueTrackerDeps;

  constructor(deps: RevenueTrackerDeps = {}) {
    this.deps = deps;
  }

  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    switch (event.eventType) {
      case "revenue.recorded":
        return this.handleRevenueRecorded(event, context);
      case "stage.advanced":
        return this.handleStageAdvanced(event);
      default:
        return { events: [], actions: [] };
    }
  }

  private handleRevenueRecorded(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const amount = payload.amount as number;
    const currency = (payload.currency as string) ?? "USD";
    const attribution = event.attribution;

    const actions: ActionRequest[] = [];
    const platformsNotified: string[] = [];

    if (attribution?.fbclid) {
      actions.push({
        actionType: "digital-ads.capi.dispatch",
        parameters: {
          eventName: "Purchase",
          fbclid: attribution.fbclid,
          value: amount,
          currency,
        },
      });
      platformsNotified.push("meta");
    }

    if (attribution?.gclid) {
      actions.push({
        actionType: "digital-ads.google.offline_conversion",
        parameters: {
          gclid: attribution.gclid,
          conversionAction: "purchase",
          conversionValue: amount,
        },
      });
      platformsNotified.push("google");
    }

    if (attribution?.ttclid) {
      actions.push({
        actionType: "digital-ads.tiktok.offline_conversion",
        parameters: {
          eventName: "CompletePayment",
          ttclid: attribution.ttclid,
          value: amount,
        },
      });
      platformsNotified.push("tiktok");
    }

    const outboundEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "revenue.attributed",
      source: { type: "agent", id: "revenue-tracker" },
      payload: {
        contactId,
        amount,
        campaignId: attribution?.sourceCampaignId ?? null,
        platformsNotified,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [outboundEvent],
      actions,
      state: {
        contactId,
        amount,
        campaignId: attribution?.sourceCampaignId ?? null,
        platformsNotified,
      },
    };
  }

  private handleStageAdvanced(event: RoutedEventEnvelope): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;

    const actions: ActionRequest[] = [
      {
        actionType: "crm.activity.log",
        parameters: {
          contactId,
          activityType: "stage_transition",
          stage,
        },
      },
    ];

    return {
      events: [],
      actions,
      state: { logged: true, stage },
    };
  }
}
