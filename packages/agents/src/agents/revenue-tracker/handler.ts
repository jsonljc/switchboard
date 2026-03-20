// ---------------------------------------------------------------------------
// Revenue Tracker — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";

export class RevenueTrackerHandler implements AgentHandler {
  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "revenue.recorded") {
      return this.handleRevenue(event, context);
    }

    if (event.eventType === "stage.advanced") {
      return this.handleStage(event, context);
    }

    if (event.eventType === "ad.optimized") {
      return this.handleAdOptimized(event, context);
    }

    return { events: [], actions: [] };
  }

  private handleRevenue(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { contactId: "string", amount: "number", currency: "string?" },
      "revenue-tracker",
    );
    const contactId = payload.contactId as string;
    const amount = payload.amount as number;
    const currency = (payload.currency as string) ?? "USD";
    const profile = context.profile ?? {};
    const revenue = profile.revenue as Record<string, unknown> | undefined;

    if (!revenue) {
      return this.escalate(event, context, contactId, "no_revenue_config");
    }

    const attributionModel = (revenue.attributionModel as string) ?? "last_click";

    const attributedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "revenue.attributed",
      source: { type: "agent", id: "revenue-tracker" },
      payload: {
        contactId,
        amount,
        currency,
        campaignId: event.attribution?.sourceCampaignId ?? null,
        adId: event.attribution?.sourceAdId ?? null,
        utmSource: event.attribution?.utmSource ?? null,
        utmMedium: event.attribution?.utmMedium ?? null,
        utmCampaign: event.attribution?.utmCampaign ?? null,
        attributionModel,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    // Dispatch conversions to connected ad platforms
    const actions: Array<{ actionType: string; parameters: Record<string, unknown> }> = [];
    const ads = profile.ads as Record<string, unknown> | undefined;
    const platforms = (ads?.connectedPlatforms as string[] | undefined) ?? [];

    for (const platform of platforms) {
      actions.push({
        actionType: "digital-ads.conversion.send",
        parameters: {
          platform,
          eventName: "Purchase",
          contactId,
          value: amount,
          currency,
          fbclid: event.attribution?.fbclid,
          gclid: event.attribution?.gclid,
          ttclid: event.attribution?.ttclid,
          sourceCampaignId: event.attribution?.sourceCampaignId,
          sourceAdId: event.attribution?.sourceAdId,
        },
      });
    }

    return {
      events: [attributedEvent],
      actions,
      state: {
        contactId,
        amount,
        campaignId: event.attribution?.sourceCampaignId ?? null,
        attributionModel,
      },
    };
  }

  private handleStage(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { contactId: "string", stage: "string" },
      "revenue-tracker",
    );
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;
    const profile = context.profile ?? {};
    const revenue = profile.revenue as Record<string, unknown> | undefined;

    if (!revenue) {
      return { events: [], actions: [] };
    }

    const trackPipeline = revenue.trackPipeline !== false;

    if (!trackPipeline) {
      return { events: [], actions: [] };
    }

    return {
      events: [],
      actions: [
        {
          actionType: "crm.activity.log",
          parameters: {
            contactId,
            activityType: "stage_transition",
            stage,
          },
        },
      ],
      state: { contactId, stage, logged: true },
    };
  }

  private handleAdOptimized(event: RoutedEventEnvelope, _context: AgentContext): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { action: "string", campaignId: "string?", triggeredBy: "string?" },
      "revenue-tracker",
    );
    const action = payload.action as string;
    const campaignId = payload.campaignId as string | undefined;

    return {
      events: [],
      actions: [
        {
          actionType: "crm.activity.log",
          parameters: {
            activityType: "ad_optimization",
            action,
            campaignId: campaignId ?? null,
            platforms: payload.platforms ?? null,
            triggeredBy: payload.triggeredBy ?? null,
          },
        },
      ],
      state: { action, campaignId: campaignId ?? null, logged: true },
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
      source: { type: "agent", id: "revenue-tracker" },
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
