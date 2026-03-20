// ---------------------------------------------------------------------------
// Ad Optimizer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";

export class AdOptimizerHandler implements AgentHandler {
  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "revenue.attributed") {
      return this.handleAttribution(event, context);
    }

    if (event.eventType === "ad.anomaly_detected") {
      return this.handleAnomaly(event, context);
    }

    if (event.eventType === "ad.performance_review") {
      return this.handlePerformanceReview(event, context);
    }

    return { events: [], actions: [] };
  }

  private handleAttribution(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { amount: "number", campaignId: "string?" },
      "ad-optimizer",
    );
    const campaignId = payload.campaignId as string | null;
    const amount = payload.amount as number;
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return { events: [], actions: [] };
    }

    // Record attribution for later budget analysis (no real-time action)
    return {
      events: [],
      actions: [],
      state: {
        lastAttribution: {
          campaignId,
          amount,
          attributionModel: payload.attributionModel,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  private handleAnomaly(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { campaignId: "string", platform: "string", metric: "string", dropPercent: "number?" },
      "ad-optimizer",
    );
    const campaignId = payload.campaignId as string;
    const platform = payload.platform as string;
    const metric = payload.metric as string;
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return this.escalate(event, context, "no_ads_config");
    }

    const anomalyThreshold = (ads.anomalyThreshold as number) ?? 30;
    const dropPercent = payload.dropPercent as number | undefined;

    if (dropPercent !== undefined && dropPercent < anomalyThreshold) {
      return { events: [], actions: [] };
    }

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        action: "anomaly_response",
        campaignId,
        platform,
        metric,
        recommendation: "pause_campaign",
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [optimizedEvent],
      actions: [
        {
          actionType: "digital-ads.campaign.adjust",
          parameters: {
            campaignId,
            platform,
            adjustment: "pause",
            reason: `Anomaly detected: ${metric} dropped ${dropPercent ?? "unknown"}%`,
          },
        },
      ],
      state: {
        action: "anomaly_response",
        campaignId,
        platform,
        metric,
      },
    };
  }

  private handlePerformanceReview(
    event: RoutedEventEnvelope,
    context: AgentContext,
  ): AgentResponse {
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return this.escalate(event, context, "no_ads_config");
    }

    const platforms = (ads.connectedPlatforms as string[]) ?? [];

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        action: "budget_review",
        platforms,
        triggeredBy: (event.payload as Record<string, unknown>).triggeredBy ?? "schedule",
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [optimizedEvent],
      actions: platforms.map((platform) => ({
        actionType: "digital-ads.budget.analyze",
        parameters: { platform, lookbackDays: 7 },
      })),
      state: {
        action: "budget_review",
        platforms,
      },
    };
  }

  private escalate(
    event: RoutedEventEnvelope,
    context: AgentContext,
    reason: string,
  ): AgentResponse {
    const escalationEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "conversation.escalated",
      source: { type: "agent", id: "ad-optimizer" },
      payload: { reason },
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
