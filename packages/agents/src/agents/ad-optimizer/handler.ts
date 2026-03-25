// ---------------------------------------------------------------------------
// Ad Optimizer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse, ActionRequest } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";
import {
  addROASRecord,
  getROASWindow,
  shouldIncreaseBudget,
  shouldDecreaseBudget,
  type ROASRecord,
} from "./roas-tracker.js";
import type { AdOptimizerDeps } from "./types.js";

const DEFAULT_BUDGET_INCREASE_PERCENT = 20;

export class AdOptimizerHandler implements AgentHandler {
  private roasHistory: ROASRecord[];

  constructor(deps: AdOptimizerDeps = {}) {
    this.roasHistory = deps.roasHistory ?? [];
  }

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "revenue.attributed") {
      return this.handleAttribution(event, config, context);
    }

    if (event.eventType === "ad.anomaly_detected") {
      return this.handleAnomaly(event, config, context);
    }

    if (event.eventType === "ad.performance_review") {
      return this.handlePerformanceReview(event, config, context);
    }

    return { events: [], actions: [] };
  }

  private handleAttribution(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
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

    // Read attribution from contact data in event metadata for campaign feedback
    const contactAttribution = event.metadata?.contactAttribution as
      | Record<string, unknown>
      | undefined;
    const attributionPlatform = (contactAttribution?.utmSource as string) ?? "unknown";

    // Record ROAS for rolling window tracking
    if (campaignId) {
      addROASRecord(this.roasHistory, {
        campaignId,
        platform: attributionPlatform,
        roas: amount > 0 ? amount / 1 : 0,
        spend: 0,
        revenue: amount,
        timestamp: event.occurredAt,
      });
    }

    return {
      events: [],
      actions: [],
      state: {
        lastAttribution: {
          campaignId,
          amount,
          attributionModel: payload.attributionModel,
          platform: attributionPlatform,
          timestamp: event.occurredAt,
        },
      },
    };
  }

  private handleAnomaly(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
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

    const anomalyThreshold =
      (ads.anomalyThreshold as number) ?? (config.anomalyThreshold as number) ?? 30;
    const dropPercent = payload.dropPercent as number | undefined;

    if (dropPercent === undefined) {
      return this.escalate(event, context, "missing_drop_percent");
    }
    if (dropPercent < anomalyThreshold) {
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
      state: { action: "anomaly_response", campaignId, platform, metric },
    };
  }

  private handlePerformanceReview(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
    const payload = validatePayload(event.payload, { triggeredBy: "string?" }, "ad-optimizer");
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return this.escalate(event, context, "no_ads_config");
    }

    const connectedPlatforms = (ads.connectedPlatforms as string[]) ?? [];
    const configPlatforms = config.platforms as string[] | undefined;
    const targetPlatforms = configPlatforms
      ? connectedPlatforms.filter((p) => configPlatforms.includes(p))
      : connectedPlatforms;

    const targetROAS = (config.targetROAS as number) ?? 2.0;
    const approvalThreshold = config.approvalThreshold as number | undefined;
    const events: RoutedEventEnvelope[] = [];
    const actions: ActionRequest[] = [];
    const budgetRecommendations: Array<{
      campaignId: string;
      platform: string;
      action: string;
    }> = [];

    // Check ROAS for each campaign in the rolling window
    const seenCampaigns = new Set<string>();
    for (const record of this.roasHistory) {
      if (!targetPlatforms.includes(record.platform) && record.platform !== "unknown") continue;
      if (seenCampaigns.has(record.campaignId)) continue;
      seenCampaigns.add(record.campaignId);

      const window = getROASWindow(this.roasHistory, record.campaignId, 7);
      if (shouldIncreaseBudget(window, targetROAS, 3)) {
        const estimatedIncrease =
          (window[window.length - 1]?.spend ?? 100) * (DEFAULT_BUDGET_INCREASE_PERCENT / 100);

        // Check approval threshold
        if (approvalThreshold !== undefined && estimatedIncrease > approvalThreshold) {
          events.push(
            createEventEnvelope({
              organizationId: context.organizationId,
              eventType: "conversation.escalated",
              source: { type: "agent", id: "ad-optimizer" },
              payload: {
                reason: "budget_approval_required",
                campaignId: record.campaignId,
                platform: record.platform,
                estimatedIncrease,
                approvalThreshold,
                consecutiveAboveTarget: window.length,
              },
              correlationId: event.correlationId,
              causationId: event.eventId,
              attribution: event.attribution,
            }),
          );
        } else {
          actions.push({
            actionType: "digital-ads.budget.increase",
            parameters: {
              campaignId: record.campaignId,
              platform: record.platform,
              increasePercent: DEFAULT_BUDGET_INCREASE_PERCENT,
              reason: `ROAS consistently above ${targetROAS} for ${window.length} cycles`,
            },
          });
          budgetRecommendations.push({
            campaignId: record.campaignId,
            platform: record.platform,
            action: "increase",
          });
        }
      } else if (shouldDecreaseBudget(window, targetROAS, 3)) {
        actions.push({
          actionType: "digital-ads.budget.decrease",
          parameters: {
            campaignId: record.campaignId,
            platform: record.platform,
            decreasePercent: DEFAULT_BUDGET_INCREASE_PERCENT,
            reason: `ROAS consistently below ${targetROAS} for ${window.length} cycles`,
          },
        });
        budgetRecommendations.push({
          campaignId: record.campaignId,
          platform: record.platform,
          action: "decrease",
        });
      }
    }

    // Standard budget analysis for all target platforms
    for (const platform of targetPlatforms) {
      actions.push({
        actionType: "digital-ads.budget.analyze",
        parameters: { platform, lookbackDays: 7 },
      });
    }

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        action: "budget_review",
        platforms: targetPlatforms,
        triggeredBy: (payload.triggeredBy as string) ?? "schedule",
        budgetRecommendations,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });
    events.push(optimizedEvent);

    return {
      events,
      actions,
      state: { action: "budget_review", platforms: targetPlatforms, budgetRecommendations },
    };
  }

  private escalate(
    event: RoutedEventEnvelope,
    context: AgentContext,
    reason: string,
  ): AgentResponse {
    return {
      events: [
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "conversation.escalated",
          source: { type: "agent", id: "ad-optimizer" },
          payload: {
            contactId:
              event.payload != null && typeof event.payload === "object"
                ? typeof (event.payload as Record<string, unknown>).contactId === "string"
                  ? (event.payload as Record<string, unknown>).contactId
                  : null
                : null,
            reason,
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      ],
      actions: [],
    };
  }
}
