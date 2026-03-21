// ---------------------------------------------------------------------------
// Revenue Tracker — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse, ActionRequest } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";
import type { RevenueTrackerDeps } from "./types.js";

const PLATFORM_TO_ACTION: Record<string, string> = {
  meta: "digital-ads.capi.dispatch",
  google: "digital-ads.google.offline_conversion",
  tiktok: "digital-ads.tiktok.offline_conversion",
};

export class RevenueTrackerHandler implements AgentHandler {
  constructor(private deps: RevenueTrackerDeps = {}) {}

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "revenue.recorded") {
      return this.handleRevenue(event, config, context);
    }

    if (event.eventType === "stage.advanced") {
      return this.handleStage(event, config, context);
    }

    if (event.eventType === "ad.optimized") {
      return this.handleAdOptimized(event, context);
    }

    return { events: [], actions: [] };
  }

  private handleRevenue(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
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
    const retryOnFailure = config.retryOnFailure !== false;
    const alertOnDeadLetter =
      (config.alertOnDeadLetter as boolean) ?? this.deps.alertOnDeadLetter ?? true;

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

    // Determine which platforms to dispatch to
    const ads = profile.ads as Record<string, unknown> | undefined;
    const connectedPlatforms = (ads?.connectedPlatforms as string[]) ?? [];
    const configPlatforms = config.platforms as string[] | undefined;
    const targetPlatforms = configPlatforms
      ? connectedPlatforms.filter((p) => configPlatforms.includes(p))
      : connectedPlatforms;

    const actions: ActionRequest[] = [];

    for (const platform of targetPlatforms) {
      const actionType = PLATFORM_TO_ACTION[platform];
      if (!actionType) continue;

      actions.push({
        actionType,
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
          retryOnFailure,
        },
      });
    }

    // Alert owner on dead letter if enabled and no platforms dispatched
    const events: RoutedEventEnvelope[] = [attributedEvent];
    if (alertOnDeadLetter && targetPlatforms.length === 0 && connectedPlatforms.length > 0) {
      actions.push({
        actionType: "messaging.escalation.notify_owner",
        parameters: {
          reason: "no_matching_platforms",
          contactId,
          amount,
          configuredPlatforms: configPlatforms ?? [],
          connectedPlatforms,
        },
      });
    }

    return {
      events,
      actions,
      state: {
        contactId,
        amount,
        campaignId: event.attribution?.sourceCampaignId ?? null,
        attributionModel,
        platformsDispatched: targetPlatforms,
      },
    };
  }

  private handleStage(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
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

    const trackPipeline = (config.trackPipeline ?? revenue.trackPipeline) !== false;
    if (!trackPipeline) {
      return { events: [], actions: [] };
    }

    return {
      events: [],
      actions: [
        {
          actionType: "crm.activity.log",
          parameters: { contactId, activityType: "stage_transition", stage },
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
    return {
      events: [
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "conversation.escalated",
          source: { type: "agent", id: "revenue-tracker" },
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
