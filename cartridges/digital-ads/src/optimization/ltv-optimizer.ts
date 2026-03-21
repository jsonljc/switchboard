/* eslint-disable max-lines */
// ---------------------------------------------------------------------------
// LTV Optimizer — Long-term customer value optimization engine
//
// Projects customer lifetime value from cohort revenue curves, generates
// campaign-level recommendations based on LTV:CAC ratios, and allocates
// budget proportionally to LTV efficiency.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface CustomerCohort {
  cohortId: string;
  /** Acquisition source/campaign */
  acquisitionCampaignId?: string;
  acquisitionAdSetId?: string;
  acquisitionDate: string;
  /** Cohort size */
  customerCount: number;
  /** Acquisition cost */
  totalAcquisitionCost: number;
  costPerAcquisition: number;
  /** Revenue over time */
  revenue: {
    day0: number;
    day7: number;
    day14: number;
    day30: number;
    day60: number;
    day90: number;
    day180?: number;
    day365?: number;
  };
  /** Retention rates */
  retention: {
    day7: number; // % retained
    day14: number;
    day30: number;
    day60: number;
    day90: number;
  };
  /** Purchase frequency */
  avgOrderCount: number;
  avgOrderValue: number;
  /** Segment info */
  segment?: string;
}

export interface LTVProjection {
  cohortId: string;
  projectedLTV: number;
  projectedLTV90: number;
  projectedLTV365: number;
  ltvToCACRatio: number;
  paybackDays: number | null;
  confidenceLevel: "high" | "medium" | "low";
  curveType: "log" | "power" | "linear";
  curveParameters: Record<string, number>;
}

export interface LTVOptimizationResult {
  cohorts: Array<{
    cohortId: string;
    acquisitionCampaignId?: string;
    customerCount: number;
    cpa: number;
    projectedLTV: number;
    ltvToCACRatio: number;
    paybackDays: number | null;
    recommendation: string;
  }>;
  /** Campaign-level LTV recommendations */
  campaignRecommendations: Array<{
    campaignId: string;
    currentCPA: number;
    maxAcceptableCPA: number;
    projectedCohortLTV: number;
    ltvToCACRatio: number;
    action: "scale" | "maintain" | "reduce" | "pause";
    reason: string;
  }>;
  /** Overall insights */
  insights: {
    avgLTV: number;
    avgPaybackDays: number | null;
    bestSegment: string | null;
    worstSegment: string | null;
    ltvDistribution: Array<{ range: string; count: number }>;
  };
  recommendations: string[];
}

export interface LTVBudgetAllocation {
  campaignId: string;
  campaignName: string;
  currentBudget: number;
  recommendedBudget: number;
  changeDollars: number;
  changePercent: number;
  projectedLTV: number;
  ltvToCACRatio: number;
  maxAcceptableCPA: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Represents a (days, revenue) data point for curve fitting. */
interface RevenueDataPoint {
  days: number;
  revenue: number;
}

/** Result of fitting a curve to revenue data. */
interface CurveFitResult {
  type: "log" | "power" | "linear";
  parameters: Record<string, number>;
  rSquared: number;
  predict: (days: number) => number;
}

// ---------------------------------------------------------------------------
// LTVOptimizer
// ---------------------------------------------------------------------------

export class LTVOptimizer {
  /** Standard benchmark: LTV should be at least 3x the CAC. */
  private static readonly DEFAULT_TARGET_LTV_TO_CAC = 3.0;
  /** Maximum budget change per campaign in a single allocation round. */
  private static readonly MAX_BUDGET_CHANGE_PERCENT = 30;
  /** Minimum daily budget per campaign. */
  private static readonly MIN_BUDGET = 5;

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  /**
   * Project lifetime value for a single customer cohort by fitting a curve
   * to its revenue-over-time data.
   *
   * Tries log, power, and linear curves and selects the best fit (highest R²).
   * Projects to 90-day and 365-day LTV, computes payback days and LTV:CAC ratio.
   */
  projectLTV(cohort: CustomerCohort): LTVProjection {
    const dataPoints = this.extractRevenueDataPoints(cohort);

    // Fit curves and select the best one
    const fits: CurveFitResult[] = [];

    const logFit = this.fitLogCurve(dataPoints);
    if (logFit) fits.push(logFit);

    const powerFit = this.fitPowerCurve(dataPoints);
    if (powerFit) fits.push(powerFit);

    const linearFit = this.fitLinearCurve(dataPoints);
    if (linearFit) fits.push(linearFit);

    // Select best fit by R²
    fits.sort((a, b) => b.rSquared - a.rSquared);
    const bestFit = fits[0] ?? this.fallbackLinear(dataPoints);

    // Project LTV at 90 and 365 days
    const projectedLTV90 = Math.max(0, bestFit.predict(90));
    const projectedLTV365 = Math.max(0, bestFit.predict(365));

    // Use 365-day projection as primary LTV estimate
    const projectedLTV = projectedLTV365;

    // Compute LTV:CAC ratio
    const cac = cohort.costPerAcquisition;
    const ltvToCACRatio = cac > 0 ? projectedLTV / cac : 0;

    // Compute payback days
    const paybackDays = this.calculatePaybackPeriod(cac, cohort.revenue);

    // Determine confidence level based on data quality
    const confidenceLevel = this.assessConfidence(dataPoints, bestFit);

    return {
      cohortId: cohort.cohortId,
      projectedLTV: Math.round(projectedLTV * 100) / 100,
      projectedLTV90: Math.round(projectedLTV90 * 100) / 100,
      projectedLTV365: Math.round(projectedLTV365 * 100) / 100,
      ltvToCACRatio: Math.round(ltvToCACRatio * 100) / 100,
      paybackDays,
      confidenceLevel,
      curveType: bestFit.type,
      curveParameters: bestFit.parameters,
    };
  }

  /**
   * Optimize campaign spend across cohorts based on projected LTV.
   *
   * For each cohort, projects LTV and computes the LTV:CAC ratio. Generates
   * campaign-level recommendations (scale, maintain, reduce, or pause) and
   * aggregates segment-level insights.
   */
  optimizeByCohortLTV(
    cohorts: CustomerCohort[],
    targetLTVtoCACRatio?: number,
  ): LTVOptimizationResult {
    const targetRatio = targetLTVtoCACRatio ?? LTVOptimizer.DEFAULT_TARGET_LTV_TO_CAC;

    // Project LTV for all cohorts
    const projections = cohorts.map((cohort) => ({
      cohort,
      projection: this.projectLTV(cohort),
    }));

    // Build cohort-level results
    const cohortResults = projections.map(({ cohort, projection }) => {
      const recommendation = this.getRecommendationText(projection.ltvToCACRatio, targetRatio);
      return {
        cohortId: cohort.cohortId,
        acquisitionCampaignId: cohort.acquisitionCampaignId,
        customerCount: cohort.customerCount,
        cpa: cohort.costPerAcquisition,
        projectedLTV: projection.projectedLTV,
        ltvToCACRatio: projection.ltvToCACRatio,
        paybackDays: projection.paybackDays,
        recommendation,
      };
    });

    // Group by campaign and generate campaign-level recommendations
    const campaignMap = new Map<string, { projections: LTVProjection[]; cpas: number[] }>();
    for (const { cohort, projection } of projections) {
      const campaignId = cohort.acquisitionCampaignId ?? "unknown";
      if (!campaignMap.has(campaignId)) {
        campaignMap.set(campaignId, { projections: [], cpas: [] });
      }
      const entry = campaignMap.get(campaignId)!;
      entry.projections.push(projection);
      entry.cpas.push(cohort.costPerAcquisition);
    }

    const campaignRecommendations = Array.from(campaignMap.entries()).map(
      ([campaignId, { projections: projs, cpas }]) => {
        const avgLTV = projs.reduce((s, p) => s + p.projectedLTV, 0) / projs.length;
        const avgCPA = cpas.reduce((s, c) => s + c, 0) / cpas.length;
        const ltvToCACRatio = avgCPA > 0 ? avgLTV / avgCPA : 0;
        const maxAcceptableCPA = avgLTV / targetRatio;
        const action = this.getAction(ltvToCACRatio);
        const reason = this.getActionReason(ltvToCACRatio, avgCPA, maxAcceptableCPA);

        return {
          campaignId,
          currentCPA: Math.round(avgCPA * 100) / 100,
          maxAcceptableCPA: Math.round(maxAcceptableCPA * 100) / 100,
          projectedCohortLTV: Math.round(avgLTV * 100) / 100,
          ltvToCACRatio: Math.round(ltvToCACRatio * 100) / 100,
          action,
          reason,
        };
      },
    );

    // Compute insights
    const insights = this.computeInsights(projections);

    // Generate top-level recommendations
    const recommendations = this.generateRecommendations(
      campaignRecommendations,
      insights,
      targetRatio,
    );

    return {
      cohorts: cohortResults,
      campaignRecommendations,
      insights,
      recommendations,
    };
  }

  /**
   * Allocate budget across campaigns proportionally to their LTV:CAC ratio.
   *
   * Maps campaigns to cohorts by acquisitionCampaignId, computes projected LTV
   * per campaign, and redistributes budget toward higher-LTV campaigns.
   * Changes are capped at 30% per campaign with a minimum budget of $5.
   */
  allocateBudgetByLTV(
    campaigns: Array<{
      campaignId: string;
      campaignName: string;
      dailyBudget: number;
      cpa: number;
    }>,
    cohorts: CustomerCohort[],
    totalBudget?: number,
  ): LTVBudgetAllocation[] {
    const targetRatio = LTVOptimizer.DEFAULT_TARGET_LTV_TO_CAC;
    const maxShift = LTVOptimizer.MAX_BUDGET_CHANGE_PERCENT;
    const minBudget = LTVOptimizer.MIN_BUDGET;

    // Build campaign -> cohort(s) mapping
    const cohortMap = new Map<string, CustomerCohort[]>();
    for (const cohort of cohorts) {
      const campaignId = cohort.acquisitionCampaignId ?? "unknown";
      if (!cohortMap.has(campaignId)) {
        cohortMap.set(campaignId, []);
      }
      cohortMap.get(campaignId)!.push(cohort);
    }

    // Compute LTV and LTV:CAC for each campaign
    const campaignLTV = campaigns.map((campaign) => {
      const campaignCohorts = cohortMap.get(campaign.campaignId) ?? [];
      let projectedLTV = 0;
      let ltvToCACRatio = 0;

      if (campaignCohorts.length > 0) {
        const projections = campaignCohorts.map((c) => this.projectLTV(c));
        projectedLTV = projections.reduce((s, p) => s + p.projectedLTV, 0) / projections.length;
        ltvToCACRatio = campaign.cpa > 0 ? projectedLTV / campaign.cpa : 0;
      }

      return {
        ...campaign,
        projectedLTV,
        ltvToCACRatio,
        maxAcceptableCPA: projectedLTV / targetRatio,
      };
    });

    // Compute total budget
    const currentTotalBudget = campaigns.reduce((s, c) => s + c.dailyBudget, 0);
    const budget = totalBudget ?? currentTotalBudget;

    // Allocate proportionally to LTV:CAC ratio
    const totalRatio = campaignLTV.reduce((s, c) => s + Math.max(0, c.ltvToCACRatio), 0);

    const allocations: LTVBudgetAllocation[] = [];

    for (const campaign of campaignLTV) {
      let recommendedBudget: number;

      if (totalRatio > 0 && campaign.ltvToCACRatio > 0) {
        const idealShare = campaign.ltvToCACRatio / totalRatio;
        recommendedBudget = budget * idealShare;
      } else {
        // No LTV data — keep current budget
        recommendedBudget = campaign.dailyBudget;
      }

      // Cap changes at maxShift% of current budget
      const maxChange = campaign.dailyBudget * (maxShift / 100);
      const change = recommendedBudget - campaign.dailyBudget;
      const cappedChange = Math.max(-maxChange, Math.min(maxChange, change));
      recommendedBudget = Math.max(minBudget, campaign.dailyBudget + cappedChange);

      const changeDollars = recommendedBudget - campaign.dailyBudget;
      const changePercent =
        campaign.dailyBudget > 0 ? (changeDollars / campaign.dailyBudget) * 100 : 0;

      const reason = this.buildAllocationReason(
        campaign.ltvToCACRatio,
        changeDollars,
        campaign.maxAcceptableCPA,
        campaign.cpa,
      );

      allocations.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        currentBudget: campaign.dailyBudget,
        recommendedBudget: Math.round(recommendedBudget * 100) / 100,
        changeDollars: Math.round(changeDollars * 100) / 100,
        changePercent: Math.round(changePercent * 10) / 10,
        projectedLTV: Math.round(campaign.projectedLTV * 100) / 100,
        ltvToCACRatio: Math.round(campaign.ltvToCACRatio * 100) / 100,
        maxAcceptableCPA: Math.round(campaign.maxAcceptableCPA * 100) / 100,
        reason,
      });
    }

    return allocations;
  }

  /**
   * Calculate the payback period in days: when cumulative revenue >= CPA.
   *
   * @param cpa           Cost per acquisition.
   * @param revenueTimeline  Object with dayN keys mapping to cumulative revenue
   *                         at that day (e.g. { day0: 10, day7: 25, ... }).
   * @returns The estimated payback day, or null if never reached within the data.
   */
  calculatePaybackPeriod(cpa: number, revenueTimeline: Record<string, number>): number | null {
    if (cpa <= 0) return 0;

    const points = this.parseRevenueTimeline(revenueTimeline);
    if (points.length === 0) return null;

    // Check if any data point already exceeds CPA
    for (const point of points) {
      if (point.revenue >= cpa) {
        // Interpolate within this segment
        const idx = points.indexOf(point);
        if (idx === 0) return point.days;

        const prev = points[idx - 1]!;
        if (prev.revenue >= cpa) return prev.days;

        // Linear interpolation between prev and current
        const dayRange = point.days - prev.days;
        const revRange = point.revenue - prev.revenue;
        if (revRange <= 0) return point.days;

        const fraction = (cpa - prev.revenue) / revRange;
        return Math.ceil(prev.days + fraction * dayRange);
      }
    }

    // Not yet reached — extrapolate using last two points
    if (points.length >= 2) {
      const last = points[points.length - 1]!;
      const secondLast = points[points.length - 2]!;
      const dailyRate =
        last.days > secondLast.days
          ? (last.revenue - secondLast.revenue) / (last.days - secondLast.days)
          : 0;

      if (dailyRate > 0) {
        const daysNeeded = (cpa - last.revenue) / dailyRate;
        return Math.ceil(last.days + daysNeeded);
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Curve fitting methods
  // -------------------------------------------------------------------------

  /**
   * Extract (days, revenue) data points from a CustomerCohort's revenue object.
   */
  private extractRevenueDataPoints(cohort: CustomerCohort): RevenueDataPoint[] {
    const points: RevenueDataPoint[] = [];
    const rev = cohort.revenue;

    const entries: [number, number | undefined][] = [
      [0, rev.day0],
      [7, rev.day7],
      [14, rev.day14],
      [30, rev.day30],
      [60, rev.day60],
      [90, rev.day90],
      [180, rev.day180],
      [365, rev.day365],
    ];

    for (const [days, revenue] of entries) {
      if (revenue !== undefined && revenue >= 0) {
        points.push({ days, revenue });
      }
    }

    return points;
  }

  /**
   * Parse a revenue timeline object (e.g. { day0: 10, day7: 25 }) into sorted
   * data points.
   */
  private parseRevenueTimeline(timeline: Record<string, number>): RevenueDataPoint[] {
    const points: RevenueDataPoint[] = [];

    for (const [key, value] of Object.entries(timeline)) {
      const match = key.match(/^day(\d+)$/);
      if (match && typeof value === "number") {
        points.push({ days: parseInt(match[1]!, 10), revenue: value });
      }
    }

    points.sort((a, b) => a.days - b.days);
    return points;
  }

  /**
   * Fit a log curve: revenue = a * ln(days + 1) + b
   * (Using days+1 to avoid ln(0) when day0 is present.)
   */
  private fitLogCurve(points: RevenueDataPoint[]): CurveFitResult | null {
    if (points.length < 2) return null;

    const n = points.length;
    const xs = points.map((p) => Math.log(p.days + 1));
    const ys = points.map((p) => p.revenue);

    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null;

    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;

    // Reject negative coefficient (revenue should increase with time)
    if (a <= 0) return null;

    const rSquared = this.computeRSquared(points, (p) => a * Math.log(p.days + 1) + b);

    return {
      type: "log",
      parameters: {
        a: Math.round(a * 1000) / 1000,
        b: Math.round(b * 1000) / 1000,
      },
      rSquared,
      predict: (days: number) => a * Math.log(days + 1) + b,
    };
  }

  /**
   * Fit a power curve: revenue = a * (days + 1)^b
   * Linearized as: ln(revenue) = ln(a) + b * ln(days + 1)
   */
  private fitPowerCurve(points: RevenueDataPoint[]): CurveFitResult | null {
    // Filter out zero-revenue points (can't take log of 0)
    const validPoints = points.filter((p) => p.revenue > 0);
    if (validPoints.length < 2) return null;

    const n = validPoints.length;
    const xs = validPoints.map((p) => Math.log(p.days + 1));
    const ys = validPoints.map((p) => Math.log(p.revenue));

    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null;

    const bCoef = (n * sumXY - sumX * sumY) / denom;
    const lnA = (sumY - bCoef * sumX) / n;
    const aCoef = Math.exp(lnA);

    // Reject negative exponent (revenue should increase with time)
    if (bCoef <= 0) return null;

    const rSquared = this.computeRSquared(points, (p) => aCoef * Math.pow(p.days + 1, bCoef));

    return {
      type: "power",
      parameters: {
        a: Math.round(aCoef * 1000) / 1000,
        b: Math.round(bCoef * 1000) / 1000,
      },
      rSquared,
      predict: (days: number) => aCoef * Math.pow(days + 1, bCoef),
    };
  }

  /**
   * Fit a linear curve: revenue = a * days + b
   */
  private fitLinearCurve(points: RevenueDataPoint[]): CurveFitResult | null {
    if (points.length < 2) return null;

    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.days, 0);
    const sumY = points.reduce((s, p) => s + p.revenue, 0);
    const sumXY = points.reduce((s, p) => s + p.days * p.revenue, 0);
    const sumXX = points.reduce((s, p) => s + p.days * p.days, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null;

    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;

    const rSquared = this.computeRSquared(points, (p) => a * p.days + b);

    return {
      type: "linear",
      parameters: {
        a: Math.round(a * 1000) / 1000,
        b: Math.round(b * 1000) / 1000,
      },
      rSquared,
      predict: (days: number) => a * days + b,
    };
  }

  /**
   * Fallback linear prediction using first and last data points.
   */
  private fallbackLinear(points: RevenueDataPoint[]): CurveFitResult {
    if (points.length === 0) {
      return {
        type: "linear",
        parameters: { a: 0, b: 0 },
        rSquared: 0,
        predict: () => 0,
      };
    }

    if (points.length === 1) {
      const r = points[0]!.revenue;
      return {
        type: "linear",
        parameters: { a: 0, b: r },
        rSquared: 0,
        predict: () => r,
      };
    }

    const first = points[0]!;
    const last = points[points.length - 1]!;
    const dayRange = last.days - first.days;
    const a = dayRange > 0 ? (last.revenue - first.revenue) / dayRange : 0;
    const b = first.revenue - a * first.days;

    return {
      type: "linear",
      parameters: {
        a: Math.round(a * 1000) / 1000,
        b: Math.round(b * 1000) / 1000,
      },
      rSquared: 0,
      predict: (days: number) => a * days + b,
    };
  }

  /**
   * Compute R² (coefficient of determination) for a fitted prediction function.
   */
  private computeRSquared(
    points: RevenueDataPoint[],
    predictFn: (point: RevenueDataPoint) => number,
  ): number {
    if (points.length < 2) return 0;

    const meanY = points.reduce((s, p) => s + p.revenue, 0) / points.length;

    const ssTotal = points.reduce((s, p) => s + (p.revenue - meanY) ** 2, 0);

    const ssResidual = points.reduce((s, p) => s + (p.revenue - predictFn(p)) ** 2, 0);

    if (ssTotal === 0) return 0;
    return Math.max(0, 1 - ssResidual / ssTotal);
  }

  // -------------------------------------------------------------------------
  // Recommendation helpers
  // -------------------------------------------------------------------------

  /**
   * Assess confidence level based on data quality and curve fit.
   */
  private assessConfidence(
    points: RevenueDataPoint[],
    fit: CurveFitResult,
  ): "high" | "medium" | "low" {
    // High: 5+ data points with good R²
    if (points.length >= 5 && fit.rSquared >= 0.85) return "high";
    // Medium: 3+ data points with decent R²
    if (points.length >= 3 && fit.rSquared >= 0.6) return "medium";
    // Low: everything else
    return "low";
  }

  /**
   * Get the recommended action based on LTV:CAC ratio.
   */
  private getAction(ltvToCACRatio: number): "scale" | "maintain" | "reduce" | "pause" {
    if (ltvToCACRatio > 4.0) return "scale";
    if (ltvToCACRatio >= 3.0) return "maintain";
    if (ltvToCACRatio >= 1.0) return "reduce";
    return "pause";
  }

  /**
   * Get a recommendation text string based on LTV:CAC ratio.
   */
  private getRecommendationText(ltvToCACRatio: number, targetRatio: number): string {
    if (ltvToCACRatio > 4.0) {
      return `Excellent LTV:CAC ratio (${ltvToCACRatio.toFixed(1)}x) — scale aggressively, room to increase CPA`;
    }
    if (ltvToCACRatio >= targetRatio) {
      return `Good LTV:CAC ratio (${ltvToCACRatio.toFixed(1)}x) — maintain or grow spend`;
    }
    if (ltvToCACRatio >= 2.0) {
      return `Below target LTV:CAC ratio (${ltvToCACRatio.toFixed(1)}x vs ${targetRatio.toFixed(1)}x target) — maintain with caution`;
    }
    if (ltvToCACRatio >= 1.0) {
      return `Low LTV:CAC ratio (${ltvToCACRatio.toFixed(1)}x) — reduce spend, acquisition costs too high relative to LTV`;
    }
    return `Negative unit economics (LTV:CAC ${ltvToCACRatio.toFixed(1)}x < 1.0) — pause immediately, losing money on each acquisition`;
  }

  /**
   * Get the reason text for a campaign-level action.
   */
  private getActionReason(
    ltvToCACRatio: number,
    currentCPA: number,
    maxAcceptableCPA: number,
  ): string {
    if (ltvToCACRatio > 4.0) {
      return `LTV:CAC ${ltvToCACRatio.toFixed(1)}x — current CPA $${currentCPA.toFixed(2)} is well below max acceptable $${maxAcceptableCPA.toFixed(2)}. Scale aggressively.`;
    }
    if (ltvToCACRatio >= 3.0) {
      return `LTV:CAC ${ltvToCACRatio.toFixed(1)}x — CPA $${currentCPA.toFixed(2)} near target max $${maxAcceptableCPA.toFixed(2)}. Maintain current spend.`;
    }
    if (ltvToCACRatio >= 2.0) {
      return `LTV:CAC ${ltvToCACRatio.toFixed(1)}x — CPA $${currentCPA.toFixed(2)} exceeds ideal max $${maxAcceptableCPA.toFixed(2)}. Maintain with caution.`;
    }
    if (ltvToCACRatio >= 1.0) {
      return `LTV:CAC ${ltvToCACRatio.toFixed(1)}x — CPA $${currentCPA.toFixed(2)} is too high (max $${maxAcceptableCPA.toFixed(2)}). Reduce spend.`;
    }
    return `LTV:CAC ${ltvToCACRatio.toFixed(1)}x — losing money. CPA $${currentCPA.toFixed(2)} exceeds lifetime value. Pause campaign.`;
  }

  /**
   * Compute aggregate insights across all cohort projections.
   */
  private computeInsights(
    projections: Array<{
      cohort: CustomerCohort;
      projection: LTVProjection;
    }>,
  ): LTVOptimizationResult["insights"] {
    if (projections.length === 0) {
      return {
        avgLTV: 0,
        avgPaybackDays: null,
        bestSegment: null,
        worstSegment: null,
        ltvDistribution: [],
      };
    }

    // Average LTV
    const avgLTV =
      projections.reduce((s, p) => s + p.projection.projectedLTV, 0) / projections.length;

    // Average payback days (exclude nulls)
    const paybackValues = projections
      .map((p) => p.projection.paybackDays)
      .filter((d): d is number => d !== null);
    const avgPaybackDays =
      paybackValues.length > 0
        ? Math.round(paybackValues.reduce((s, d) => s + d, 0) / paybackValues.length)
        : null;

    // Best/worst segments
    const segmentMap = new Map<string, { totalLTV: number; count: number }>();
    for (const { cohort, projection } of projections) {
      const segment = cohort.segment ?? "default";
      if (!segmentMap.has(segment)) {
        segmentMap.set(segment, { totalLTV: 0, count: 0 });
      }
      const entry = segmentMap.get(segment)!;
      entry.totalLTV += projection.projectedLTV;
      entry.count += 1;
    }

    let bestSegment: string | null = null;
    let worstSegment: string | null = null;
    let bestAvgLTV = -Infinity;
    let worstAvgLTV = Infinity;

    for (const [segment, { totalLTV, count }] of segmentMap) {
      const avg = totalLTV / count;
      if (avg > bestAvgLTV) {
        bestAvgLTV = avg;
        bestSegment = segment;
      }
      if (avg < worstAvgLTV) {
        worstAvgLTV = avg;
        worstSegment = segment;
      }
    }

    // LTV distribution
    const ranges = [
      { range: "$0-$50", min: 0, max: 50 },
      { range: "$50-$100", min: 50, max: 100 },
      { range: "$100-$200", min: 100, max: 200 },
      { range: "$200-$500", min: 200, max: 500 },
      { range: "$500-$1000", min: 500, max: 1000 },
      { range: "$1000+", min: 1000, max: Infinity },
    ];

    const ltvDistribution = ranges.map(({ range, min, max }) => ({
      range,
      count: projections.filter(
        (p) => p.projection.projectedLTV >= min && p.projection.projectedLTV < max,
      ).length,
    }));

    return {
      avgLTV: Math.round(avgLTV * 100) / 100,
      avgPaybackDays,
      bestSegment: bestSegment !== "default" ? bestSegment : null,
      worstSegment: worstSegment !== "default" ? worstSegment : null,
      ltvDistribution,
    };
  }

  /**
   * Generate top-level recommendation strings.
   */
  private generateRecommendations(
    campaignRecs: LTVOptimizationResult["campaignRecommendations"],
    insights: LTVOptimizationResult["insights"],
    targetRatio: number,
  ): string[] {
    const recommendations: string[] = [];

    const scaleCount = campaignRecs.filter((r) => r.action === "scale").length;
    const pauseCount = campaignRecs.filter((r) => r.action === "pause").length;
    const reduceCount = campaignRecs.filter((r) => r.action === "reduce").length;

    if (scaleCount > 0) {
      recommendations.push(
        `${scaleCount} campaign(s) have excellent LTV:CAC ratios (>4.0x) and should be scaled aggressively`,
      );
    }

    if (pauseCount > 0) {
      recommendations.push(
        `${pauseCount} campaign(s) have negative unit economics (LTV:CAC <1.0x) — pause immediately to stop losses`,
      );
    }

    if (reduceCount > 0) {
      recommendations.push(
        `${reduceCount} campaign(s) have LTV:CAC ratios between 1.0x-2.0x — reduce spend and improve targeting to lower CPA`,
      );
    }

    if (insights.avgPaybackDays !== null) {
      if (insights.avgPaybackDays <= 30) {
        recommendations.push(
          `Average payback period is ${insights.avgPaybackDays} days — healthy cash flow, can reinvest quickly`,
        );
      } else if (insights.avgPaybackDays <= 90) {
        recommendations.push(
          `Average payback period is ${insights.avgPaybackDays} days — moderate, ensure cash flow supports this timeline`,
        );
      } else {
        recommendations.push(
          `Average payback period is ${insights.avgPaybackDays} days — long payback, consider improving early revenue or reducing CPA`,
        );
      }
    }

    if (insights.bestSegment) {
      recommendations.push(
        `Best-performing segment: "${insights.bestSegment}" — consider expanding targeting for this segment`,
      );
    }

    if (insights.worstSegment && insights.worstSegment !== insights.bestSegment) {
      recommendations.push(
        `Worst-performing segment: "${insights.worstSegment}" — review targeting and consider reducing investment`,
      );
    }

    const belowTarget = campaignRecs.filter(
      (r) => r.ltvToCACRatio < targetRatio && r.ltvToCACRatio >= 1.0,
    );
    if (belowTarget.length > 0) {
      const avgGap =
        belowTarget.reduce((s, r) => s + (r.maxAcceptableCPA - r.currentCPA), 0) /
        belowTarget.length;
      if (avgGap < 0) {
        recommendations.push(
          `${belowTarget.length} campaign(s) need to reduce CPA by an average of $${Math.abs(avgGap).toFixed(2)} to reach the ${targetRatio.toFixed(1)}x LTV:CAC target`,
        );
      }
    }

    return recommendations;
  }

  /**
   * Build the reason string for a budget allocation entry.
   */
  private buildAllocationReason(
    ltvToCACRatio: number,
    changeDollars: number,
    maxAcceptableCPA: number,
    currentCPA: number,
  ): string {
    if (ltvToCACRatio <= 0) {
      return "No LTV data available — maintaining current budget";
    }

    const ratioStr = `LTV:CAC ${ltvToCACRatio.toFixed(1)}x`;
    const cpaStr = `CPA $${currentCPA.toFixed(2)} vs max $${maxAcceptableCPA.toFixed(2)}`;

    if (changeDollars > 1) {
      return `Increase: ${ratioStr} above average — ${cpaStr}`;
    }
    if (changeDollars < -1) {
      return `Decrease: ${ratioStr} below average — ${cpaStr}`;
    }
    return `Maintain: ${ratioStr} — ${cpaStr}`;
  }
}
