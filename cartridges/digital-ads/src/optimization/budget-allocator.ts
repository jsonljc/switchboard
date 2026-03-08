// ---------------------------------------------------------------------------
// Budget Allocator — Portfolio-level marginal CPA optimization engine
//
// Replaces the old linear efficiency scoring with a mathematically optimal
// approach: fit log curves per campaign, then equalize marginal CPAs across
// the portfolio using Lagrangian optimization.
//
// Falls back to efficiency scoring for campaigns with insufficient data.
// ---------------------------------------------------------------------------

import type { BudgetReallocationPlan, BudgetReallocationEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface CampaignPerformanceData {
  campaignId: string;
  campaignName: string;
  dailyBudget: number;
  spend: number;
  conversions: number;
  cpa: number | null;
  roas: number | null;
  impressions: number;
  deliveryStatus: string;
}

export interface CampaignHistoricalData {
  campaignId: string;
  dataPoints: Array<{ spend: number; conversions: number }>;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FittedCampaign {
  campaign: CampaignPerformanceData;
  a: number;
  b: number;
}

interface FallbackCampaign {
  campaign: CampaignPerformanceData;
  score: number;
}

// ---------------------------------------------------------------------------
// BudgetAllocator
// ---------------------------------------------------------------------------

export class BudgetAllocator {
  /** Minimum number of historical data points required to fit a log curve. */
  private static readonly MIN_DATA_POINTS = 7;

  /**
   * Generate budget reallocation recommendations.
   *
   * When `historicalData` is provided and campaigns have >= 7 data points,
   * the allocator fits a log curve per campaign and uses Lagrangian
   * optimization to equalize marginal CPAs across the portfolio.
   *
   * Campaigns with insufficient data fall back to the linear efficiency
   * scoring heuristic.
   *
   * @param campaigns  Current performance snapshot for each campaign.
   * @param options    Tuning knobs (maxShiftPercent, preserveMinBudget).
   * @param historicalData  Optional array of historical spend/conversion
   *                        data points per campaign.  When omitted the
   *                        allocator uses the efficiency-score fallback for
   *                        all campaigns.
   */
  recommend(
    campaigns: CampaignPerformanceData[],
    options?: {
      maxShiftPercent?: number;
      preserveMinBudget?: number;
    },
    historicalData?: CampaignHistoricalData[],
  ): BudgetReallocationPlan {
    const maxShift = options?.maxShiftPercent ?? 30;
    const minBudget = options?.preserveMinBudget ?? 5;

    if (campaigns.length < 2) {
      return {
        entries: [],
        totalCurrentBudget: campaigns.reduce((s, c) => s + c.dailyBudget, 0),
        totalRecommendedBudget: campaigns.reduce((s, c) => s + c.dailyBudget, 0),
        summary: "Need at least 2 campaigns for budget reallocation",
        method: "efficiency_score",
      };
    }

    // Build a lookup for historical data keyed by campaignId.
    const histMap = new Map<string, CampaignHistoricalData>();
    if (historicalData) {
      for (const hd of historicalData) {
        histMap.set(hd.campaignId, hd);
      }
    }

    // Partition campaigns into those that can be curve-fit and those that
    // fall back to efficiency scoring.
    const fitted: FittedCampaign[] = [];
    const fallback: FallbackCampaign[] = [];

    for (const campaign of campaigns) {
      const hist = histMap.get(campaign.campaignId);
      const validPoints = hist
        ? hist.dataPoints.filter((p) => p.spend > 0 && p.conversions > 0)
        : [];

      if (validPoints.length >= BudgetAllocator.MIN_DATA_POINTS) {
        const { a, b } = this.fitLogCurve(validPoints);
        // Only use the curve if the coefficient is positive — negative `a`
        // means conversions *decrease* with spend which makes no economic
        // sense and would produce nonsensical allocations.
        if (a > 0) {
          fitted.push({ campaign, a, b });
        } else {
          fallback.push({ campaign, score: this.computeEfficiencyScore(campaign) });
        }
      } else {
        fallback.push({ campaign, score: this.computeEfficiencyScore(campaign) });
      }
    }

    // If we have no fitted campaigns, fall back entirely.
    if (fitted.length === 0) {
      return this.allocateByEfficiencyScore(campaigns, maxShift, minBudget);
    }

    // -----------------------------------------------------------------------
    // Marginal CPA optimization via Lagrangian multiplier
    //
    // For campaign i with curve:  conv_i = a_i * ln(spend_i) + b_i
    //   marginal conversion rate:  dConv/dSpend = a_i / spend_i
    //   marginal CPA:              spend_i / a_i
    //
    // Optimal allocation equalizes marginal CPA across all fitted campaigns:
    //   spend_i / a_i = lambda  for all i
    //   => spend_i = lambda * a_i
    //
    // Budget constraint for the fitted subset:
    //   sum(spend_i) = fittedBudget
    //   lambda * sum(a_i) = fittedBudget
    //   lambda = fittedBudget / sum(a_i)
    // -----------------------------------------------------------------------

    const totalBudget = campaigns.reduce((s, c) => s + c.dailyBudget, 0);

    // Reserve budget for fallback campaigns (keep their current budgets
    // as the base — the efficiency-score method will redistribute within
    // this pool).
    const fallbackBudget = fallback.reduce(
      (s, fb) => s + fb.campaign.dailyBudget,
      0,
    );
    const fittedBudget = totalBudget - fallbackBudget;

    const sumA = fitted.reduce((s, f) => s + f.a, 0);
    const lambda = sumA > 0 ? fittedBudget / sumA : 0;

    // Build entries for fitted campaigns.
    const entries: BudgetReallocationEntry[] = [];

    for (const { campaign, a, b } of fitted) {
      let idealBudget = lambda * a;

      // Cap the shift at maxShiftPercent of current budget.
      const maxChange = campaign.dailyBudget * (maxShift / 100);
      const change = idealBudget - campaign.dailyBudget;
      const cappedChange = Math.max(-maxChange, Math.min(maxChange, change));
      idealBudget = Math.max(minBudget, campaign.dailyBudget + cappedChange);

      const changeDollars = idealBudget - campaign.dailyBudget;
      const changePercent =
        campaign.dailyBudget > 0
          ? (changeDollars / campaign.dailyBudget) * 100
          : 0;

      // Marginal CPA at the *recommended* spend level.
      const marginalCPA = a > 0 ? idealBudget / a : null;

      const reason = this.buildMarginalCPAReason(changeDollars, marginalCPA, a);

      entries.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        currentDailyBudget: campaign.dailyBudget,
        recommendedDailyBudget: Math.round(idealBudget * 100) / 100,
        changeDollars: Math.round(changeDollars * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        reason,
        marginalCPA: marginalCPA !== null ? Math.round(marginalCPA * 100) / 100 : null,
        curveParameters: {
          a: Math.round(a * 1000) / 1000,
          b: Math.round(b * 1000) / 1000,
        },
      });
    }

    // Build entries for fallback campaigns using efficiency scoring within
    // their own budget pool.
    if (fallback.length > 0) {
      const fallbackEntries = this.allocateFallbackCampaigns(
        fallback,
        fallbackBudget,
        maxShift,
        minBudget,
      );
      entries.push(...fallbackEntries);
    }

    const changedEntries = entries.filter((e) => Math.abs(e.changeDollars) > 1);
    const fittedCount = fitted.length;
    const fallbackCount = fallback.length;

    let methodNote = "";
    if (fallbackCount > 0) {
      methodNote = ` (${fittedCount} via marginal CPA, ${fallbackCount} via efficiency score)`;
    }

    return {
      entries,
      totalCurrentBudget: totalBudget,
      totalRecommendedBudget: entries.reduce(
        (s, e) => s + e.recommendedDailyBudget,
        0,
      ),
      summary:
        changedEntries.length > 0
          ? `${changedEntries.length} campaign(s) recommended for budget adjustment${methodNote}`
          : `All campaigns are efficiently allocated${methodNote}`,
      method: fitted.length > 0 ? "marginal_cpa" : "efficiency_score",
    };
  }

  // -------------------------------------------------------------------------
  // Efficiency-score fallback (original heuristic)
  // -------------------------------------------------------------------------

  /**
   * Allocate budget purely based on efficiency scores.
   * Used when no historical data is available.
   */
  private allocateByEfficiencyScore(
    campaigns: CampaignPerformanceData[],
    maxShift: number,
    minBudget: number,
  ): BudgetReallocationPlan {
    const scored = campaigns.map((c) => ({
      ...c,
      score: this.computeEfficiencyScore(c),
    }));

    scored.sort((a, b) => b.score - a.score);

    const totalBudget = scored.reduce((s, c) => s + c.dailyBudget, 0);
    const totalScore = scored.reduce((s, c) => s + c.score, 0);
    const entries: BudgetReallocationEntry[] = [];

    for (const campaign of scored) {
      const idealShare =
        totalScore > 0 ? campaign.score / totalScore : 1 / scored.length;
      let idealBudget = totalBudget * idealShare;

      const maxChange = campaign.dailyBudget * (maxShift / 100);
      const change = idealBudget - campaign.dailyBudget;
      const cappedChange = Math.max(-maxChange, Math.min(maxChange, change));
      idealBudget = Math.max(minBudget, campaign.dailyBudget + cappedChange);

      const changeDollars = idealBudget - campaign.dailyBudget;
      const changePercent =
        campaign.dailyBudget > 0
          ? (changeDollars / campaign.dailyBudget) * 100
          : 0;

      let reason: string;
      if (changeDollars > 1) {
        reason =
          campaign.cpa !== null
            ? `Increase: CPA ($${campaign.cpa.toFixed(2)}) is below average`
            : "Increase: Strong performance metrics";
      } else if (changeDollars < -1) {
        reason =
          campaign.cpa !== null
            ? `Decrease: CPA ($${campaign.cpa.toFixed(2)}) is above average`
            : "Decrease: Underperforming relative to other campaigns";
      } else {
        reason = "Budget is appropriately allocated";
      }

      entries.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        currentDailyBudget: campaign.dailyBudget,
        recommendedDailyBudget: Math.round(idealBudget * 100) / 100,
        changeDollars: Math.round(changeDollars * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        reason,
        marginalCPA: null,
        curveParameters: null,
      });
    }

    const changedEntries = entries.filter((e) => Math.abs(e.changeDollars) > 1);

    return {
      entries,
      totalCurrentBudget: totalBudget,
      totalRecommendedBudget: entries.reduce(
        (s, e) => s + e.recommendedDailyBudget,
        0,
      ),
      summary:
        changedEntries.length > 0
          ? `${changedEntries.length} campaign(s) recommended for budget adjustment`
          : "All campaigns are efficiently allocated",
      method: "efficiency_score",
    };
  }

  /**
   * Allocate budget among fallback (insufficient-data) campaigns using
   * efficiency scores, constrained to the given budget pool.
   */
  private allocateFallbackCampaigns(
    fallbackCampaigns: FallbackCampaign[],
    budgetPool: number,
    maxShift: number,
    minBudget: number,
  ): BudgetReallocationEntry[] {
    const totalScore = fallbackCampaigns.reduce((s, fc) => s + fc.score, 0);
    const entries: BudgetReallocationEntry[] = [];

    for (const { campaign, score } of fallbackCampaigns) {
      const idealShare =
        totalScore > 0 ? score / totalScore : 1 / fallbackCampaigns.length;
      let idealBudget = budgetPool * idealShare;

      const maxChange = campaign.dailyBudget * (maxShift / 100);
      const change = idealBudget - campaign.dailyBudget;
      const cappedChange = Math.max(-maxChange, Math.min(maxChange, change));
      idealBudget = Math.max(minBudget, campaign.dailyBudget + cappedChange);

      const changeDollars = idealBudget - campaign.dailyBudget;
      const changePercent =
        campaign.dailyBudget > 0
          ? (changeDollars / campaign.dailyBudget) * 100
          : 0;

      let reason: string;
      if (changeDollars > 1) {
        reason =
          campaign.cpa !== null
            ? `Increase (efficiency score): CPA ($${campaign.cpa.toFixed(2)}) is below average`
            : "Increase (efficiency score): Strong performance metrics";
      } else if (changeDollars < -1) {
        reason =
          campaign.cpa !== null
            ? `Decrease (efficiency score): CPA ($${campaign.cpa.toFixed(2)}) is above average`
            : "Decrease (efficiency score): Underperforming relative to other campaigns";
      } else {
        reason = "Budget is appropriately allocated (efficiency score fallback)";
      }

      entries.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        currentDailyBudget: campaign.dailyBudget,
        recommendedDailyBudget: Math.round(idealBudget * 100) / 100,
        changeDollars: Math.round(changeDollars * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        reason,
        marginalCPA: null,
        curveParameters: null,
      });
    }

    return entries;
  }

  // -------------------------------------------------------------------------
  // Log-curve fitting (mirrors DiminishingReturnsAnalyzer)
  // -------------------------------------------------------------------------

  /**
   * Fit a log curve (conversions = a * ln(spend) + b) using ordinary least
   * squares regression.  Transforms x = ln(spend) and fits the linear model
   * y = a*x + b.
   */
  private fitLogCurve(
    points: Array<{ spend: number; conversions: number }>,
  ): { a: number; b: number } {
    const n = points.length;

    const xs = points.map((p) => Math.log(p.spend));
    const ys = points.map((p) => p.conversions);

    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) {
      const meanY = sumY / n;
      return { a: 0, b: meanY };
    }

    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;

    return { a, b };
  }

  // -------------------------------------------------------------------------
  // Scoring helpers
  // -------------------------------------------------------------------------

  /**
   * Heuristic efficiency score used as a fallback when insufficient
   * historical data is available for curve fitting.
   */
  private computeEfficiencyScore(campaign: CampaignPerformanceData): number {
    let score = 50; // Base score

    // CPA-based scoring (lower = better)
    if (campaign.cpa !== null && campaign.cpa > 0) {
      score += Math.max(0, 30 - campaign.cpa);
    }

    // ROAS-based scoring (higher = better)
    if (campaign.roas !== null) {
      score += campaign.roas * 5;
    }

    // Delivery penalty
    if (campaign.deliveryStatus === "LEARNING_LIMITED") {
      score *= 0.7;
    } else if (campaign.spend === 0) {
      score *= 0.3;
    }

    return Math.max(1, score);
  }

  // -------------------------------------------------------------------------
  // Reason-string builders
  // -------------------------------------------------------------------------

  private buildMarginalCPAReason(
    changeDollars: number,
    marginalCPA: number | null,
    a: number,
  ): string {
    const mcpaStr =
      marginalCPA !== null ? ` (marginal CPA: $${marginalCPA.toFixed(2)})` : "";
    const curveStr = ` [curve coefficient a=${a.toFixed(3)}]`;

    if (changeDollars > 1) {
      return `Increase: High marginal efficiency${mcpaStr}${curveStr}`;
    } else if (changeDollars < -1) {
      return `Decrease: Low marginal efficiency${mcpaStr}${curveStr}`;
    }
    return `Budget is near-optimal${mcpaStr}${curveStr}`;
  }
}
