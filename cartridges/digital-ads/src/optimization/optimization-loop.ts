// ---------------------------------------------------------------------------
// Optimization Loop — Full optimization review cycle
// ---------------------------------------------------------------------------

import type { OptimizationReviewResult } from "./types.js";

export class OptimizationLoop {
  /**
   * Run a full optimization review for an account.
   * Analyzes budget allocation, bid strategies, creatives, and audiences.
   * Returns tier 1 (auto-execute) and tier 2 (recommend+approve) actions.
   */
  async review(params: {
    accountId: string;
    campaigns: Array<{
      campaignId: string;
      campaignName: string;
      dailyBudget: number;
      spend: number;
      conversions: number;
      cpa: number | null;
      roas: number | null;
      deliveryStatus: string;
    }>;
    adSets: Array<{
      adSetId: string;
      campaignId: string;
      dailyBudget: number;
      spend: number;
      conversions: number;
      cpa: number | null;
      bidStrategy: string;
      bidAmount: number | null;
      learningPhase: boolean;
    }>;
  }): Promise<OptimizationReviewResult> {
    const tier1Actions: OptimizationReviewResult["tier1Actions"] = [];
    const tier2Actions: OptimizationReviewResult["tier2Actions"] = [];

    // Budget analysis — small adjustments are Tier 1
    for (const campaign of params.campaigns) {
      if (campaign.spend === 0 && campaign.dailyBudget > 0) {
        tier2Actions.push({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: campaign.campaignId },
          reason: `Campaign "${campaign.campaignName}" has $0 spend — may have delivery issues`,
          riskLevel: "medium",
        });
      }
    }

    // Budget skew detection — flag campaigns with disproportionate budget vs conversions
    const totalBudget = params.campaigns.reduce((s, c) => s + c.dailyBudget, 0);
    const totalCampaignConversions = params.campaigns.reduce((s, c) => s + c.conversions, 0);
    if (totalBudget > 0 && totalCampaignConversions > 0) {
      for (const campaign of params.campaigns) {
        const budgetShare = campaign.dailyBudget / totalBudget;
        const conversionShare = campaign.conversions / totalCampaignConversions;
        if (budgetShare > 0.6 && conversionShare < 0.3) {
          tier2Actions.push({
            actionType: "digital-ads.campaign.adjust_budget",
            parameters: { campaignId: campaign.campaignId },
            reason: `Campaign "${campaign.campaignName}" has ${(budgetShare * 100).toFixed(0)}% of budget but only ${(conversionShare * 100).toFixed(0)}% of conversions — consider redistributing`,
            riskLevel: "medium",
          });
        }
      }
    }

    // Bid strategy mismatch — flag ad sets with uncapped bidding and high CPA
    const adSetCPAs = params.adSets
      .filter((a) => a.cpa !== null && a.cpa > 0)
      .map((a) => a.cpa as number);
    const avgAdSetCPA =
      adSetCPAs.length > 0 ? adSetCPAs.reduce((s, c) => s + c, 0) / adSetCPAs.length : 0;
    if (avgAdSetCPA > 0) {
      for (const adSet of params.adSets) {
        if (
          adSet.bidStrategy === "LOWEST_COST_WITHOUT_CAP" &&
          adSet.cpa !== null &&
          adSet.cpa > avgAdSetCPA * 2
        ) {
          tier2Actions.push({
            actionType: "digital-ads.bid.update_strategy",
            parameters: { adSetId: adSet.adSetId, bidStrategy: "COST_CAP" },
            reason: `Ad set ${adSet.adSetId} uses LOWEST_COST_WITHOUT_CAP but CPA ($${adSet.cpa.toFixed(2)}) is >2x the average ($${avgAdSetCPA.toFixed(2)}) — switch to COST_CAP`,
            riskLevel: "medium",
          });
        }
      }
    }

    // Ad set level — pause zero-conversion ad sets with significant spend
    for (const adSet of params.adSets) {
      if (adSet.conversions === 0 && adSet.spend > (adSet.cpa ?? 50) * 2) {
        tier1Actions.push({
          actionType: "digital-ads.adset.pause",
          parameters: { adSetId: adSet.adSetId },
          reason: `Zero conversions after $${adSet.spend.toFixed(2)} spend (>2x target CPA)`,
        });
      }
    }

    // Creative fatigue actions — pause ad sets with high spend but zero conversions
    for (const adSet of params.adSets) {
      if (adSet.spend > 500 && adSet.conversions === 0) {
        // Only add if not already covered by the zero-conversion check above
        const alreadyPaused = tier1Actions.some(
          (a) =>
            a.actionType === "digital-ads.adset.pause" &&
            (a.parameters as Record<string, unknown>).adSetId === adSet.adSetId,
        );
        if (!alreadyPaused) {
          tier1Actions.push({
            actionType: "digital-ads.adset.pause",
            parameters: { adSetId: adSet.adSetId },
            reason: `Ad set ${adSet.adSetId} has spent >$500 with zero conversions — pausing for creative fatigue`,
          });
        }
      }
    }

    // Calculate overall score
    const totalSpend = params.campaigns.reduce((s, c) => s + c.spend, 0);
    const totalConversions = params.campaigns.reduce((s, c) => s + c.conversions, 0);
    const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const learningCount = params.adSets.filter((a) => a.learningPhase).length;
    const overallScore = Math.max(
      0,
      Math.min(100, 100 - learningCount * 5 - tier2Actions.length * 10 - (avgCPA > 100 ? 20 : 0)),
    );

    return {
      accountId: params.accountId,
      reviewedAt: new Date().toISOString(),
      budgetRecommendations: {
        entries: [],
        totalCurrentBudget: params.campaigns.reduce((s, c) => s + c.dailyBudget, 0),
        totalRecommendedBudget: params.campaigns.reduce((s, c) => s + c.dailyBudget, 0),
        summary: `Reviewed ${params.campaigns.length} campaigns`,
        method: "efficiency_score",
      },
      bidRecommendations: [],
      creativeRecommendations: [],
      audienceRecommendations: [],
      overallScore,
      tier1Actions,
      tier2Actions,
    };
  }
}
