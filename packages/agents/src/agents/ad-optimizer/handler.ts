// ---------------------------------------------------------------------------
// Ad Optimizer Agent — handler
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import type { AdOptimizerDeps, CampaignSnapshot } from "./types.js";

interface RevenueAttributedPayload {
  campaignId?: string;
  platform?: string;
  entityId?: string;
  revenue?: number;
}

export class AdOptimizerHandler implements AgentHandler {
  private readonly deps: AdOptimizerDeps;

  constructor(deps: AdOptimizerDeps = {}) {
    this.deps = deps;
  }

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "revenue.attributed") {
      return { events: [], actions: [] };
    }

    const payload = event.payload as RevenueAttributedPayload;
    const campaignId = payload.campaignId ?? "unknown";
    const platform = payload.platform ?? "unknown";
    const entityId = payload.entityId ?? campaignId;

    const targetROAS = typeof config.targetROAS === "number" ? config.targetROAS : 4.0;
    const maxBudgetChangePercent =
      typeof config.maxBudgetChangePercent === "number" ? config.maxBudgetChangePercent : 20;

    let snapshot: CampaignSnapshot | null = null;
    if (this.deps.fetchSnapshot) {
      snapshot = await this.deps.fetchSnapshot({ platform, entityId });
    }

    const actions: AgentResponse["actions"] = [];
    let optimizationAction = "none";
    let reason = "no snapshot available";

    if (snapshot) {
      const roas = snapshot.spend > 0 ? snapshot.revenue / snapshot.spend : 0;

      if (snapshot.spend > 0 && snapshot.revenue === 0) {
        // Zero ROAS — pause the campaign
        optimizationAction = "pause";
        reason = "zero revenue with active spend";
        actions.push({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId },
        });
      } else if (roas < targetROAS && roas > 0) {
        // Below-target ROAS — reduce budget
        const reductionPercent = Math.min(
          maxBudgetChangePercent,
          ((targetROAS - roas) / targetROAS) * 100,
        );
        const newBudget = snapshot.spend * (1 - reductionPercent / 100);
        optimizationAction = "adjust_budget";
        reason = `ROAS ${roas.toFixed(2)} below target ${targetROAS}`;
        actions.push({
          actionType: "digital-ads.campaign.adjust_budget",
          parameters: { campaignId, newBudget: Math.round(newBudget * 100) / 100 },
        });
      } else {
        optimizationAction = "none";
        reason = `ROAS ${roas.toFixed(2)} meets or exceeds target ${targetROAS}`;
      }
    }

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        campaignId,
        platform,
        optimizationAction,
        reason,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
    });

    return {
      events: [optimizedEvent],
      actions,
      state: {
        campaignId,
        platform,
        optimizationAction,
        reason,
        snapshot: snapshot ?? undefined,
      },
    };
  }
}
