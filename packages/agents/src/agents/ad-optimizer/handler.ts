// ---------------------------------------------------------------------------
// Ad Optimizer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";

export class AdOptimizerHandler implements AgentHandler {
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

    return { events: [], actions: [] };
  }

  private handleRevenue(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const amount = payload.amount as number;
    const currency = (payload.currency as string) ?? "USD";
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return this.escalate(event, context, contactId, "no_ads_config");
    }

    const platforms = ads.connectedPlatforms as string[] | undefined;
    if (!platforms || platforms.length === 0) {
      return this.escalate(event, context, contactId, "no_connected_platforms");
    }

    const actions = platforms.map((platform) => ({
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
    }));

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        contactId,
        action: "conversion_sent",
        platforms,
        eventName: "Purchase",
        value: amount,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [optimizedEvent],
      actions,
      state: {
        contactId,
        action: "conversion_sent",
        platforms,
      },
    };
  }

  private handleStage(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return { events: [], actions: [] };
    }

    const platforms = ads.connectedPlatforms as string[] | undefined;
    const conversionEventMap = ads.conversionEventMap as Record<string, string> | undefined;

    if (!conversionEventMap || !conversionEventMap[stage]) {
      return { events: [], actions: [] };
    }

    if (!platforms || platforms.length === 0) {
      return { events: [], actions: [] };
    }

    const eventName = conversionEventMap[stage]!;

    const actions = platforms.map((platform) => ({
      actionType: "digital-ads.conversion.send",
      parameters: {
        platform,
        eventName,
        contactId,
        fbclid: event.attribution?.fbclid,
        gclid: event.attribution?.gclid,
        ttclid: event.attribution?.ttclid,
        sourceCampaignId: event.attribution?.sourceCampaignId,
        sourceAdId: event.attribution?.sourceAdId,
      },
    }));

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        contactId,
        action: "stage_conversion_sent",
        platforms,
        eventName,
        stage,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [optimizedEvent],
      actions,
      state: {
        contactId,
        action: "stage_conversion_sent",
        stage,
        eventName,
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
      source: { type: "agent", id: "ad-optimizer" },
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
