// ---------------------------------------------------------------------------
// Bid Strategy Engine — Bid strategy recommendation + execution
// ---------------------------------------------------------------------------

import type { BidStrategyRecommendation } from "./types.js";

export interface AdSetBidData {
  adSetId: string;
  currentBidStrategy: string;
  currentBidAmount: number | null;
  optimizationGoal: string;
  cpa: number | null;
  roas: number | null;
  spend: number;
  conversions: number;
  deliveryStatus: string;
  learningPhase: boolean;
}

export class BidStrategyEngine {
  recommend(adSets: AdSetBidData[]): BidStrategyRecommendation[] {
    const recommendations: BidStrategyRecommendation[] = [];

    for (const adSet of adSets) {
      if (adSet.learningPhase) continue; // Skip ad sets in learning phase

      const rec = this.analyzeAdSet(adSet);
      if (rec) recommendations.push(rec);
    }

    return recommendations;
  }

  private analyzeAdSet(adSet: AdSetBidData): BidStrategyRecommendation | null {
    const current = adSet.currentBidStrategy;

    // If using lowest cost and CPA is volatile, recommend cost cap
    if (current === "LOWEST_COST_WITHOUT_CAP" && adSet.cpa !== null && adSet.spend > 100) {
      return {
        adSetId: adSet.adSetId,
        currentStrategy: current,
        recommendedStrategy: "COST_CAP",
        recommendedBidAmount: Math.round(adSet.cpa * 1.2 * 100) / 100,
        reason: "Switch to cost cap to stabilize CPA — currently using uncapped lowest cost",
        expectedImpact: `Target CPA of ~$${(adSet.cpa * 1.2).toFixed(2)} with more stable delivery`,
      };
    }

    // If cost cap is too restrictive (limited delivery), raise or switch
    if (current === "COST_CAP" && adSet.deliveryStatus === "LEARNING_LIMITED") {
      const newBid = adSet.currentBidAmount ? adSet.currentBidAmount * 1.3 : null;
      return {
        adSetId: adSet.adSetId,
        currentStrategy: current,
        recommendedStrategy: "COST_CAP",
        recommendedBidAmount: newBid ? Math.round(newBid * 100) / 100 : null,
        reason: "Delivery is limited — cost cap may be too restrictive",
        expectedImpact:
          "Increase bid cap by 30% to improve delivery while maintaining cost efficiency",
      };
    }

    // If using bid cap with strong ROAS, consider minimum ROAS
    if (current === "LOWEST_COST_WITH_BID_CAP" && adSet.roas !== null && adSet.roas > 2) {
      return {
        adSetId: adSet.adSetId,
        currentStrategy: current,
        recommendedStrategy: "MINIMUM_ROAS",
        recommendedBidAmount: Math.round(adSet.roas * 0.8 * 100) / 100,
        reason: `Strong ROAS (${adSet.roas.toFixed(2)}) — switch to minimum ROAS bidding`,
        expectedImpact: `Optimize for ${(adSet.roas * 0.8).toFixed(2)}x ROAS target`,
      };
    }

    return null;
  }
}
