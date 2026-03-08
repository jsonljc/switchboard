// ---------------------------------------------------------------------------
// Annual Planner — Quarterly & annual planning with phased budgets
// ---------------------------------------------------------------------------
// Extends the forecasting module to support long-range planning. Uses
// seasonal multipliers from the seasonality calendar, diminishing returns
// from the log model, and vertical-specific strategy templates.
// ---------------------------------------------------------------------------

import { SEASONAL_EVENTS } from "../core/analysis/seasonality.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

export interface MonthlyPlan {
  month: number; // 1-12
  monthName: string;
  quarter: Quarter;
  /** Budget allocation */
  plannedBudget: number;
  budgetSharePercent: number;
  /** Seasonal adjustments */
  seasonalMultiplier: number;
  activeSeasonalEvents: string[];
  /** Projected performance */
  projectedImpressions: number;
  projectedConversions: number;
  projectedCPA: number;
  projectedROAS: number | null;
  projectedSpendEfficiency: number; // 0-1, diminishing returns factor
  /** Strategic focus */
  strategicFocus: string;
  keyActions: string[];
  /** Testing calendar */
  testingSlots: number; // recommended number of creative tests this month
}

export interface QuarterlyPlan {
  quarter: Quarter;
  months: MonthlyPlan[];
  totalBudget: number;
  budgetSharePercent: number;
  projectedConversions: number;
  projectedCPA: number;
  strategicTheme: string;
  keyMilestones: string[];
}

export interface AnnualPlan {
  year: number;
  totalAnnualBudget: number;
  quarters: QuarterlyPlan[];
  /** Annual summary */
  projectedAnnualConversions: number;
  projectedAnnualCPA: number;
  projectedAnnualROAS: number | null;
  /** Growth trajectory */
  monthOverMonthGrowth: number[]; // projected MoM growth rates
  /** Risk factors */
  risks: Array<{
    risk: string;
    severity: "high" | "medium" | "low";
    mitigation: string;
  }>;
  /** Key recommendations */
  recommendations: string[];
}

export interface AnnualPlanParams {
  totalAnnualBudget: number;
  vertical: "commerce" | "leadgen" | "brand";
  businessGoal: string;
  /** Current performance baseline */
  currentMonthlyCPA: number;
  currentMonthlyConversions: number;
  currentMonthlySpend: number;
  currentROAS?: number;
  /** Growth targets */
  targetAnnualGrowth?: number; // e.g. 0.20 for 20% growth
  targetCPA?: number;
  /** Historical seasonality (optional, overrides defaults) */
  historicalMonthlyData?: Array<{
    month: number;
    spend: number;
    conversions: number;
    revenue?: number;
  }>;
  /** Planning preferences */
  frontLoadBudget?: boolean; // spend more in H1
  aggressiveScaling?: boolean; // take more risk for growth
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Maps month (1-based) to its Quarter. */
function monthToQuarter(month: number): Quarter {
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

/** Quarterly theme templates. */
const QUARTERLY_THEMES: Record<Quarter, string> = {
  Q1: "Foundation & Testing",
  Q2: "Growth & Scaling",
  Q3: "Optimization & Preparation",
  Q4: "Peak Performance",
};

/** Quarterly milestone templates. */
const QUARTERLY_MILESTONES: Record<Quarter, string[]> = {
  Q1: [
    "Establish performance baselines",
    "Launch initial creative tests",
    "Optimize pixel/CAPI signal quality",
    "Finalize audience strategy",
  ],
  Q2: [
    "Expand audience reach by 20-30%",
    "Launch 2-3 new campaign structures",
    "Hit mid-year conversion targets",
    "Build lookalike audience pipeline",
  ],
  Q3: [
    "Refine targeting based on H1 learnings",
    "Build Q4 creative backlog (15-20 variants)",
    "Test holiday messaging angles",
    "Optimize landing pages for peak season",
  ],
  Q4: [
    "Maximize BFCM conversion volume",
    "Manage CPM inflation with bid caps",
    "Hit annual revenue/conversion targets",
    "Document learnings for next year planning",
  ],
};

/**
 * Default seasonal budget weights by vertical.
 * Each array has 12 elements (Jan-Dec), summing to ~12.0 (1.0 avg).
 */
const DEFAULT_WEIGHTS: Record<string, number[]> = {
  // Commerce: heavy Q4 (BFCM/holiday), lighter Q1
  commerce: [0.7, 0.75, 0.8, 0.9, 0.95, 0.9, 1.0, 1.05, 1.1, 1.15, 1.4, 1.3],
  // Leadgen: more even, slight Q1/Q3 emphasis (budget planning cycles)
  leadgen: [1.1, 1.05, 1.0, 0.95, 0.9, 0.9, 0.95, 1.0, 1.1, 1.05, 0.95, 1.05],
  // Brand: emphasis on Q2/Q3 (summer reach), moderate Q4
  brand: [0.85, 0.85, 0.9, 1.05, 1.1, 1.15, 1.1, 1.1, 1.0, 0.95, 1.0, 0.95],
};

/**
 * Month-level strategic focus templates by vertical.
 */
const STRATEGIC_FOCUS: Record<string, string[]> = {
  commerce: [
    "Post-holiday audience rebuilding & clearance sales",
    "Valentine's Day promotions & spring collection teasers",
    "Spring collection launch & Easter promotions",
    "New product launches & spring seasonal push",
    "Mother's Day campaigns & summer preview",
    "Mid-year sale events & summer catalog refresh",
    "Prime Day competitive response & summer promotions",
    "Back-to-school campaigns & fall preview",
    "Fall collection launch & Q4 preparation",
    "Pre-holiday audience warming & early bird deals",
    "BFCM mega-push & peak conversion volume",
    "Holiday gift guides & year-end clearance",
  ],
  leadgen: [
    "New year planning webinars & thought leadership",
    "Industry report launches & lead magnet testing",
    "Q1 pipeline review & content asset refresh",
    "Spring webinar series & case study promotion",
    "Mid-year assessment campaigns & lead nurture optimization",
    "Half-year review content & pipeline acceleration",
    "Industry event preparation & pre-event registration",
    "Back-to-business campaigns & fall content calendar",
    "Q4 budget planning guides & decision-maker targeting",
    "Year-end planning resources & budget cycle alignment",
    "Budget approval season targeting & ROI case studies",
    "Year-end wrap-up content & next-year planning hooks",
  ],
  brand: [
    "Brand refresh campaigns & awareness baseline measurement",
    "Brand storytelling series launch & Valentine's activations",
    "Spring awareness campaigns & brand lift study setup",
    "Campaign amplification & reach optimization",
    "Summer brand campaign launch & frequency management",
    "Peak summer reach & brand engagement events",
    "Mid-summer brand activation & creative refresh",
    "Back-to-school brand presence & fall campaign prep",
    "Fall brand campaign & awareness study analysis",
    "Pre-holiday brand positioning & emotional storytelling",
    "Holiday brand presence & seasonal messaging",
    "Year-end brand recap & loyalty reinforcement",
  ],
};

/**
 * Month-level key actions by vertical.
 */
const KEY_ACTIONS: Record<string, string[][]> = {
  commerce: [
    ["Analyze holiday performance data", "Reset audience exclusions", "Plan Q1 product launches"],
    ["Launch Valentine's promotions", "Test new creative angles", "Refresh product catalog"],
    ["Run spring sale campaigns", "Optimize for Easter traffic", "Test dynamic product ads"],
    ["Launch new products", "A/B test landing pages", "Expand lookalike audiences"],
    ["Run Mother's Day campaigns", "Preview summer collections", "Optimize checkout funnel"],
    ["Execute mid-year sale", "Refresh catalog feed", "Test video ad formats"],
    ["Counter Prime Day competition", "Run summer clearance", "Test new bidding strategies"],
    ["Launch back-to-school campaigns", "Preview fall collection", "Build retargeting pools"],
    ["Launch fall collection", "Build Q4 creative assets", "Test holiday messaging"],
    ["Warm holiday audiences", "Launch early bird deals", "Finalize Q4 bid strategy"],
    ["Execute BFCM campaigns", "Maximize conversion volume", "Monitor CPM inflation"],
    ["Run gift guide campaigns", "Execute clearance sales", "Document annual learnings"],
  ],
  leadgen: [
    [
      "Launch New Year planning webinars",
      "Create industry outlook content",
      "Test lead form variations",
    ],
    ["Publish annual industry report", "Run LinkedIn campaigns", "Optimize lead scoring"],
    ["Review Q1 pipeline", "Refresh lead magnets", "Test new audience segments"],
    ["Launch spring webinar series", "Promote case studies", "A/B test ad copy"],
    ["Run mid-year assessment campaigns", "Optimize lead nurture flow", "Test gated content"],
    ["Publish half-year review", "Accelerate pipeline", "Optimize cost per qualified lead"],
    ["Prepare for industry events", "Launch pre-event registrations", "Build event audiences"],
    ["Run back-to-business campaigns", "Launch fall content calendar", "Test video testimonials"],
    ["Publish Q4 budget planning guides", "Target decision-makers", "Optimize form conversion"],
    [
      "Create year-end planning resources",
      "Align with budget cycles",
      "Run executive-targeted ads",
    ],
    ["Target budget approval season", "Promote ROI case studies", "Maximize qualified leads"],
    ["Wrap-up content campaigns", "Plan next year strategy", "Archive winning creatives"],
  ],
  brand: [
    ["Launch brand refresh", "Set awareness baseline", "Test brand messaging"],
    ["Run storytelling series", "Activate Valentine's brand presence", "Measure aided recall"],
    ["Launch spring awareness campaign", "Set up brand lift study", "Test frequency caps"],
    ["Amplify top-performing creatives", "Optimize reach campaigns", "Analyze brand lift data"],
    ["Launch summer brand campaign", "Manage ad frequency", "Test new creative formats"],
    ["Maximize summer reach", "Run brand engagement events", "Optimize video completion rates"],
    ["Refresh brand creatives", "Launch mid-summer activation", "Test influencer partnerships"],
    ["Prepare fall campaign", "Build brand presence for back-to-school", "Optimize placements"],
    ["Launch fall brand campaign", "Analyze awareness study results", "Refresh creative assets"],
    ["Position brand for holidays", "Launch emotional storytelling", "Test seasonal messaging"],
    ["Maintain holiday brand presence", "Run seasonal brand content", "Optimize holiday reach"],
    ["Year-end brand recap", "Reinforce loyalty messaging", "Plan next year brand strategy"],
  ],
};

// ---------------------------------------------------------------------------
// AnnualPlanner
// ---------------------------------------------------------------------------

export class AnnualPlanner {
  /**
   * Build a full 12-month annual plan with quarterly roll-ups.
   */
  createAnnualPlan(params: AnnualPlanParams): AnnualPlan {
    const {
      totalAnnualBudget,
      vertical,
      currentMonthlyCPA,
      currentMonthlyConversions,
      currentROAS,
      targetAnnualGrowth,
      frontLoadBudget,
      aggressiveScaling,
      historicalMonthlyData,
    } = params;

    const year = new Date().getFullYear();

    // 1. Compute seasonal budget weights
    const weights = this.getSeasonalBudgetWeights(vertical, historicalMonthlyData);

    // Apply front-load adjustment if requested: boost H1, reduce H2
    if (frontLoadBudget) {
      for (let i = 0; i < 6; i++) {
        weights[i]! *= 1.15;
      }
      for (let i = 6; i < 12; i++) {
        weights[i]! *= 0.85;
      }
    }

    // Normalise weights so they sum to 12
    const weightSum = weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < 12; i++) {
      weights[i] = (weights[i]! / weightSum) * 12;
    }

    // 2. Compute monthly budgets from weights
    const monthlyBudgetAvg = totalAnnualBudget / 12;
    const monthlyBudgets = weights.map((w) => Math.round(w * monthlyBudgetAvg * 100) / 100);

    // 3. Build seasonal multipliers per month from SEASONAL_EVENTS
    const seasonalMultipliers = this.computeMonthlySeasonalMultipliers();

    // 4. Compute growth ramp — gradual improvement over the year
    const growthTarget = targetAnnualGrowth ?? 0.15; // default 15%
    const monthlyGrowthFactor = Math.pow(1 + growthTarget, 1 / 12);

    // 5. Build month plans
    const monthPlans: MonthlyPlan[] = [];
    const momGrowth: number[] = [];
    let prevConversions: number | null = null;

    for (let m = 0; m < 12; m++) {
      const month = m + 1;
      const budget = monthlyBudgets[m]!;
      const seasonalMult = seasonalMultipliers[m]!;
      const activeEvents = this.getEventsForMonth(month);

      // Growth ramp — CPA improves (decreases) over time as optimizations compound
      const growthRamp = Math.pow(monthlyGrowthFactor, m);
      const scalingPenalty = aggressiveScaling ? 0.95 : 1.0; // aggressive = slightly worse efficiency

      const { projectedConversions } = this.projectMonthlyPerformance(
        budget,
        currentMonthlyCPA,
        currentMonthlyConversions,
        seasonalMult,
      );

      // Apply growth trajectory to conversions
      const adjustedConversions =
        Math.round(projectedConversions * growthRamp * scalingPenalty * 100) / 100;
      const adjustedCPA =
        adjustedConversions > 0 ? Math.round((budget / adjustedConversions) * 100) / 100 : 0;

      // Spend efficiency: ratio of baseline CPA to projected CPA (1.0 = same, <1 = diminishing returns)
      const spendEfficiency =
        adjustedCPA > 0
          ? Math.min(1, Math.round((currentMonthlyCPA / adjustedCPA) * 100) / 100)
          : 0;

      // Projected impressions (rough: budget / estimated CPM)
      const baseCPM = vertical === "brand" ? 5 : vertical === "commerce" ? 12 : 10;
      const effectiveCPM = baseCPM * seasonalMult;
      const projectedImpressions = Math.round((budget / effectiveCPM) * 1000);

      // ROAS
      let projectedROAS: number | null = null;
      if (currentROAS != null && currentROAS > 0) {
        // Scale ROAS inversely with seasonal CPA inflation but positively with growth
        projectedROAS = Math.round(currentROAS * growthRamp * (1 / seasonalMult) * 100) / 100;
      }

      // MoM growth
      if (prevConversions !== null && prevConversions > 0) {
        momGrowth.push(
          Math.round(((adjustedConversions - prevConversions) / prevConversions) * 10000) / 10000,
        );
      }
      prevConversions = adjustedConversions;

      // Testing slots: more during low-competition months (low seasonal multiplier)
      const testingSlots = seasonalMult <= 1.1 ? 4 : seasonalMult <= 1.3 ? 3 : 2;

      monthPlans.push({
        month,
        monthName: MONTH_NAMES[m]!,
        quarter: monthToQuarter(month),
        plannedBudget: budget,
        budgetSharePercent: Math.round((budget / totalAnnualBudget) * 10000) / 100,
        seasonalMultiplier: seasonalMult,
        activeSeasonalEvents: activeEvents,
        projectedImpressions,
        projectedConversions: adjustedConversions,
        projectedCPA: adjustedCPA,
        projectedROAS,
        projectedSpendEfficiency: spendEfficiency,
        strategicFocus: STRATEGIC_FOCUS[vertical]?.[m] ?? "",
        keyActions: KEY_ACTIONS[vertical]?.[m] ?? [],
        testingSlots,
      });
    }

    // 6. Build quarterly roll-ups
    const quarters: QuarterlyPlan[] = (["Q1", "Q2", "Q3", "Q4"] as Quarter[]).map((q) => {
      const qMonths = monthPlans.filter((mp) => mp.quarter === q);
      const totalBudget = qMonths.reduce((s, mp) => s + mp.plannedBudget, 0);
      const totalConversions = qMonths.reduce((s, mp) => s + mp.projectedConversions, 0);
      const avgCPA =
        totalConversions > 0 ? Math.round((totalBudget / totalConversions) * 100) / 100 : 0;

      return {
        quarter: q,
        months: qMonths,
        totalBudget: Math.round(totalBudget * 100) / 100,
        budgetSharePercent: Math.round((totalBudget / totalAnnualBudget) * 10000) / 100,
        projectedConversions: Math.round(totalConversions * 100) / 100,
        projectedCPA: avgCPA,
        strategicTheme: QUARTERLY_THEMES[q],
        keyMilestones: QUARTERLY_MILESTONES[q],
      };
    });

    // 7. Annual summary
    const totalConversions = monthPlans.reduce((s, mp) => s + mp.projectedConversions, 0);
    const annualCPA =
      totalConversions > 0 ? Math.round((totalAnnualBudget / totalConversions) * 100) / 100 : 0;

    let annualROAS: number | null = null;
    if (currentROAS != null) {
      const roasValues = monthPlans
        .map((mp) => mp.projectedROAS)
        .filter((r): r is number => r !== null);
      if (roasValues.length > 0) {
        annualROAS =
          Math.round((roasValues.reduce((s, r) => s + r, 0) / roasValues.length) * 100) / 100;
      }
    }

    // 8. Risk assessment
    const risks = this.assessRisks(params, monthPlans);

    // 9. Recommendations
    const recommendations = this.generateRecommendations(params, monthPlans, quarters);

    return {
      year,
      totalAnnualBudget,
      quarters,
      projectedAnnualConversions: Math.round(totalConversions * 100) / 100,
      projectedAnnualCPA: annualCPA,
      projectedAnnualROAS: annualROAS,
      monthOverMonthGrowth: momGrowth,
      risks,
      recommendations,
    };
  }

  /**
   * Returns a 12-element array of monthly budget weight factors.
   * If historical data is provided, weights are derived from conversion patterns.
   * Otherwise, vertical-specific defaults are used.
   */
  getSeasonalBudgetWeights(
    vertical: string,
    historicalData?: Array<{ month: number; spend: number; conversions: number }>,
  ): number[] {
    if (historicalData && historicalData.length >= 6) {
      return this.computeHistoricalWeights(historicalData);
    }
    // Use default vertical weights (copy to avoid mutation)
    return [...(DEFAULT_WEIGHTS[vertical] ?? DEFAULT_WEIGHTS.commerce!)];
  }

  /**
   * Project monthly performance at a given budget level.
   * Uses a log-based diminishing returns model and applies seasonal CPA adjustments.
   */
  projectMonthlyPerformance(
    monthlyBudget: number,
    baselineCPA: number,
    baselineConversions: number,
    seasonalMultiplier: number,
  ): { projectedConversions: number; projectedCPA: number } {
    if (monthlyBudget <= 0 || baselineCPA <= 0 || baselineConversions <= 0) {
      return { projectedConversions: 0, projectedCPA: 0 };
    }

    // Baseline spend = baseline conversions * baseline CPA
    const baselineSpend = baselineConversions * baselineCPA;

    if (baselineSpend <= 0) {
      return { projectedConversions: 0, projectedCPA: 0 };
    }

    // Log model: conversions = a * ln(spend)
    // At baseline: baselineConversions = a * ln(baselineSpend)
    // Therefore: a = baselineConversions / ln(baselineSpend)
    const lnBaseline = Math.log(baselineSpend);
    if (lnBaseline <= 0) {
      return { projectedConversions: baselineConversions, projectedCPA: baselineCPA };
    }

    const a = baselineConversions / lnBaseline;
    const lnBudget = Math.log(monthlyBudget);
    let projectedConversions = Math.max(0, a * lnBudget);

    // Apply seasonal CPA multiplier — higher multiplier = higher CPM = fewer conversions per dollar
    projectedConversions = projectedConversions / seasonalMultiplier;

    const projectedCPA =
      projectedConversions > 0 ? Math.round((monthlyBudget / projectedConversions) * 100) / 100 : 0;

    return {
      projectedConversions: Math.round(projectedConversions * 100) / 100,
      projectedCPA,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute monthly budget weights from historical conversion data.
   * Months with more conversions get proportionally higher weights.
   */
  private computeHistoricalWeights(
    data: Array<{ month: number; spend: number; conversions: number }>,
  ): number[] {
    // Aggregate conversions by month
    const monthConversions = new Array(12).fill(0) as number[];
    const monthCounts = new Array(12).fill(0) as number[];

    for (const d of data) {
      if (d.month >= 1 && d.month <= 12) {
        monthConversions[d.month - 1]! += d.conversions;
        monthCounts[d.month - 1]! += 1;
      }
    }

    // Average conversions per month
    const avgConversions = monthConversions.map((total, i) =>
      monthCounts[i]! > 0 ? total / monthCounts[i]! : 0,
    );

    // Convert to weights — normalized so they sum to 12
    const totalAvg = avgConversions.reduce((s, v) => s + v, 0);
    if (totalAvg <= 0) {
      return [...DEFAULT_WEIGHTS.commerce!];
    }

    return avgConversions.map((v) => (v / totalAvg) * 12);
  }

  /**
   * Compute a representative seasonal CPM/CPA multiplier for each month
   * based on the SEASONAL_EVENTS calendar.
   */
  private computeMonthlySeasonalMultipliers(): number[] {
    const multipliers = new Array(12).fill(1.0) as number[];

    for (const event of SEASONAL_EVENTS) {
      const startMonth = parseInt(event.startMMDD.split("-")[0]!, 10);
      const endMonth = parseInt(event.endMMDD.split("-")[0]!, 10);
      const startDay = parseInt(event.startMMDD.split("-")[1]!, 10);
      const endDay = parseInt(event.endMMDD.split("-")[1]!, 10);

      // For each month the event touches, blend the multiplier based on
      // how many days of the month the event covers
      if (startMonth === endMonth) {
        // Event within one month
        const daysInMonth = this.daysInMonth(startMonth);
        const eventDays = endDay - startDay + 1;
        const coverage = eventDays / daysInMonth;
        const blended = 1 + (event.cpmThresholdMultiplier - 1) * coverage;
        multipliers[startMonth - 1] = Math.max(multipliers[startMonth - 1]!, blended);
      } else {
        // Event spans two months
        // First month contribution
        const daysInStart = this.daysInMonth(startMonth);
        const startCoverage = (daysInStart - startDay + 1) / daysInStart;
        const blendedStart = 1 + (event.cpmThresholdMultiplier - 1) * startCoverage;
        multipliers[startMonth - 1] = Math.max(multipliers[startMonth - 1]!, blendedStart);

        // Second month contribution
        const daysInEnd = this.daysInMonth(endMonth);
        const endCoverage = endDay / daysInEnd;
        const blendedEnd = 1 + (event.cpmThresholdMultiplier - 1) * endCoverage;
        multipliers[endMonth - 1] = Math.max(multipliers[endMonth - 1]!, blendedEnd);

        // Any full months in between
        for (let m = startMonth + 1; m < endMonth; m++) {
          multipliers[m - 1] = Math.max(multipliers[m - 1]!, event.cpmThresholdMultiplier);
        }
      }
    }

    // Round for cleanliness
    return multipliers.map((m) => Math.round(m * 100) / 100);
  }

  /** Get names of seasonal events active during a given month. */
  private getEventsForMonth(month: number): string[] {
    const events: string[] = [];

    for (const event of SEASONAL_EVENTS) {
      const eventStartMonth = parseInt(event.startMMDD.split("-")[0]!, 10);
      const eventEndMonth = parseInt(event.endMMDD.split("-")[0]!, 10);

      if (eventStartMonth <= eventEndMonth) {
        // Normal range (e.g., 11-20 to 12-02)
        if (month >= eventStartMonth && month <= eventEndMonth) {
          events.push(event.name);
        }
      } else {
        // Year-wrapping range (e.g., 12-26 to 01-05)
        if (month >= eventStartMonth || month <= eventEndMonth) {
          events.push(event.name);
        }
      }
    }

    return events;
  }

  /** Days in a month (non-leap year). */
  private daysInMonth(month: number): number {
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return days[month - 1] ?? 30;
  }

  /**
   * Assess risks for the annual plan.
   */
  private assessRisks(params: AnnualPlanParams, monthPlans: MonthlyPlan[]): AnnualPlan["risks"] {
    const risks: AnnualPlan["risks"] = [];
    const { vertical, totalAnnualBudget, currentMonthlySpend, aggressiveScaling } = params;

    // 1. Budget scaling risk
    const annualizedCurrentSpend = currentMonthlySpend * 12;
    const budgetIncrease = totalAnnualBudget / annualizedCurrentSpend;

    if (budgetIncrease > 2) {
      risks.push({
        risk: "Aggressive budget scaling — annual budget is more than 2x current annualized spend",
        severity: "high",
        mitigation:
          "Phase budget increases gradually (15-20% per month). Monitor marginal CPA closely and pause scaling if marginal CPA exceeds 2.5x average.",
      });
    } else if (budgetIncrease > 1.5) {
      risks.push({
        risk: "Significant budget increase — plan requires 50%+ more annual spend",
        severity: "medium",
        mitigation:
          "Increase budgets in 10-15% increments. Use A/B budget tests to validate efficiency at higher spend levels before full rollout.",
      });
    }

    // 2. Seasonal CPM risk
    const q4Months = monthPlans.filter((mp) => mp.quarter === "Q4");
    const maxSeasonalMult = Math.max(...q4Months.map((mp) => mp.seasonalMultiplier));
    if (maxSeasonalMult > 1.3) {
      risks.push({
        risk: `Q4 CPM inflation — seasonal multiplier peaks at ${maxSeasonalMult}x`,
        severity: vertical === "commerce" ? "high" : "medium",
        mitigation:
          "Set bid caps during peak periods. Pre-build audiences in Q3. Shift some Q4 budget to early November for lower CPMs.",
      });
    }

    // 3. Creative fatigue risk
    const totalTestSlots = monthPlans.reduce((s, mp) => s + mp.testingSlots, 0);
    if (totalTestSlots < 30) {
      risks.push({
        risk: "Creative fatigue — insufficient testing cadence to sustain year-long campaigns",
        severity: "medium",
        mitigation:
          "Aim for 3-4 creative tests per month. Build a creative pipeline with at least 2 months lead time. Use dynamic creative optimization.",
      });
    }

    // 4. Audience saturation risk
    if (aggressiveScaling) {
      risks.push({
        risk: "Audience saturation — aggressive scaling may exhaust core audiences within 6-9 months",
        severity: "high",
        mitigation:
          "Diversify audience sources quarterly. Expand to lookalike audiences at different percentage tiers. Test new interest categories monthly.",
      });
    } else {
      risks.push({
        risk: "Audience saturation — prolonged campaigns risk frequency overexposure",
        severity: "low",
        mitigation:
          "Monitor frequency caps monthly. Rotate audiences quarterly. Use exclusion lists for converted users.",
      });
    }

    // 5. Signal degradation risk
    risks.push({
      risk: "Signal quality degradation — privacy changes or pixel issues could degrade optimization",
      severity: "medium",
      mitigation:
        "Implement Conversions API (CAPI) if not already. Monitor Event Match Quality (EMQ) monthly. Maintain first-party data pipeline.",
    });

    // 6. Platform dependency risk
    risks.push({
      risk: "Single-platform concentration — relying on one ad platform increases vulnerability",
      severity: "low",
      mitigation:
        "Consider allocating 10-20% of budget to secondary platforms for diversification. Test Google/TikTok during Q2 when primary platform CPMs are lower.",
    });

    return risks;
  }

  /**
   * Generate strategic recommendations based on the plan.
   */
  private generateRecommendations(
    params: AnnualPlanParams,
    monthPlans: MonthlyPlan[],
    _quarters: QuarterlyPlan[],
  ): string[] {
    const recommendations: string[] = [];
    const { vertical, totalAnnualBudget, currentMonthlySpend, targetCPA } = params;

    // Budget pacing recommendation
    const avgMonthlyBudget = totalAnnualBudget / 12;
    if (avgMonthlyBudget > currentMonthlySpend * 1.5) {
      recommendations.push(
        `Plan requires scaling monthly spend from $${currentMonthlySpend.toLocaleString()} to an average of $${Math.round(avgMonthlyBudget).toLocaleString()}. Start with 15% monthly increases in Q1 and validate CPA stability before accelerating.`,
      );
    }

    // CPA target feasibility
    if (targetCPA != null && targetCPA > 0) {
      const avgProjectedCPA =
        monthPlans.reduce((s, mp) => s + mp.projectedCPA, 0) / monthPlans.length;
      if (targetCPA < avgProjectedCPA * 0.7) {
        recommendations.push(
          `Target CPA of $${targetCPA.toFixed(2)} is ambitious — projected average CPA is $${avgProjectedCPA.toFixed(2)}. Focus on signal quality (CAPI, EMQ) and creative optimization to close the gap.`,
        );
      } else if (targetCPA < avgProjectedCPA) {
        recommendations.push(
          `Target CPA of $${targetCPA.toFixed(2)} is achievable with optimization — projected average CPA is $${avgProjectedCPA.toFixed(2)}. Prioritize audience refinement and landing page optimization.`,
        );
      }
    }

    // Vertical-specific recommendations
    switch (vertical) {
      case "commerce":
        recommendations.push(
          "Build Q4 creative assets during Q3 — plan for 15-20 ad variants to combat creative fatigue during BFCM.",
        );
        recommendations.push(
          "Set up dynamic product ads (DPA) with catalog sales objective for retargeting during peak season.",
        );
        break;
      case "leadgen":
        recommendations.push(
          "Align campaign calendar with industry events and budget planning cycles (Q1 new year, Q3 next-year budgeting).",
        );
        recommendations.push(
          "Implement lead scoring to focus optimization on qualified leads rather than volume. Track cost per qualified lead alongside CPA.",
        );
        break;
      case "brand":
        recommendations.push(
          "Schedule brand lift studies in Q2 and Q4 to measure awareness impact and validate reach investments.",
        );
        recommendations.push(
          "Optimize for ThruPlay (15s+ video views) rather than impressions to ensure meaningful brand exposure.",
        );
        break;
    }

    // Testing cadence recommendation
    recommendations.push(
      "Maintain a minimum of 2-3 creative tests per month. Increase testing to 4 during low-competition months (Q1, early Q3) when CPMs are lower.",
    );

    // Efficiency monitoring recommendation
    const lowEfficiencyMonths = monthPlans.filter((mp) => mp.projectedSpendEfficiency < 0.7);
    if (lowEfficiencyMonths.length > 0) {
      const monthNames = lowEfficiencyMonths.map((mp) => mp.monthName).join(", ");
      recommendations.push(
        `Months with projected diminishing returns (efficiency <70%): ${monthNames}. Consider reallocating excess budget from these months to higher-efficiency periods.`,
      );
    }

    return recommendations;
  }
}
