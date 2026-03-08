// ---------------------------------------------------------------------------
// Geo-Holdout Experiment Manager — Geographic incrementality measurement
// ---------------------------------------------------------------------------
// Extends the A/B testing framework to support geographic holdout experiments
// for true incrementality measurement using difference-in-differences.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeoExperimentStatus =
  | "draft"
  | "running"
  | "cooldown"
  | "analyzing"
  | "concluded"
  | "cancelled";

export interface GeoRegion {
  id: string;
  name: string;
  type: "dma" | "state" | "country" | "custom";
  population?: number;
  historicalSpend?: number;
  historicalConversions?: number;
}

export interface GeoExperimentConfig {
  id: string;
  name: string;
  hypothesis: string;
  status: GeoExperimentStatus;
  /** Treatment regions where ads will run */
  treatmentRegions: GeoRegion[];
  /** Holdout/control regions where ads are paused */
  holdoutRegions: GeoRegion[];
  /** How regions were assigned */
  assignmentMethod: "random" | "matched_pairs" | "stratified";
  /** Primary metric to measure incrementality */
  primaryMetric: "conversions" | "revenue" | "store_visits";
  /** Duration configuration */
  preTestDays: number;
  testDays: number;
  cooldownDays: number;
  startDate: string | null;
  endDate: string | null;
  /** Budget configuration */
  treatmentBudgetPerDay: number;
  /** Results (populated after analysis) */
  results: GeoExperimentResult | null;
  createdAt: string;
}

export interface GeoRegionMetrics {
  regionId: string;
  preTestConversions: number;
  preTestRevenue: number;
  testConversions: number;
  testRevenue: number;
  postTestConversions: number;
  postTestRevenue: number;
}

export interface GeoExperimentResult {
  treatmentMetrics: GeoRegionMetrics[];
  holdoutMetrics: GeoRegionMetrics[];
  /** Aggregate results */
  incrementalConversions: number;
  incrementalRevenue: number;
  incrementalCostPerConversion: number;
  incrementalROAS: number | null;
  /** Lift calculation */
  liftPercent: number;
  liftConfidenceInterval: { lower: number; upper: number };
  /** Statistical testing */
  pValue: number;
  significant: boolean;
  confidenceLevel: number;
  /** Spend during test */
  totalSpend: number;
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Design params
// ---------------------------------------------------------------------------

export interface DesignExperimentParams {
  name: string;
  hypothesis: string;
  availableRegions: GeoRegion[];
  primaryMetric: "conversions" | "revenue" | "store_visits";
  testDays: number;
  preTestDays?: number;
  cooldownDays?: number;
  treatmentBudgetPerDay: number;
}

export interface PowerAnalysisParams {
  baselineConversionRatePerRegion: number;
  minimumDetectableLift: number;
  numberOfRegions: number;
  significanceLevel?: number;
  power?: number;
}

export interface PowerAnalysisResult {
  minimumTestDays: number;
  requiredEffectSize: number;
  regionCount: number;
  significanceLevel: number;
  power: number;
  assumptions: string[];
}

// ---------------------------------------------------------------------------
// GeoExperimentManager
// ---------------------------------------------------------------------------

export class GeoExperimentManager {
  private experiments = new Map<string, GeoExperimentConfig>();
  private nextId = 1;

  /**
   * Design a geo-holdout experiment with matched-pair region assignment.
   *
   * Matched-pair assignment:
   * 1. Sort regions by historicalConversions (descending)
   * 2. Pair adjacent regions
   * 3. Randomly assign one in each pair to treatment, the other to holdout
   */
  designExperiment(params: DesignExperimentParams): GeoExperimentConfig {
    const {
      name,
      hypothesis,
      availableRegions,
      primaryMetric,
      testDays,
      preTestDays = 14,
      cooldownDays = 7,
      treatmentBudgetPerDay,
    } = params;

    if (availableRegions.length < 2) {
      throw new Error("At least 2 regions are required for a geo experiment");
    }

    // Sort by historical conversions descending for matched-pair assignment
    const sorted = [...availableRegions].sort(
      (a, b) => (b.historicalConversions ?? 0) - (a.historicalConversions ?? 0),
    );

    const treatmentRegions: GeoRegion[] = [];
    const holdoutRegions: GeoRegion[] = [];

    // Pair adjacent regions and randomly assign within each pair
    for (let i = 0; i < sorted.length - 1; i += 2) {
      const first = sorted[i]!;
      const second = sorted[i + 1]!;

      // Random coin flip for assignment within the pair
      if (Math.random() < 0.5) {
        treatmentRegions.push(first);
        holdoutRegions.push(second);
      } else {
        holdoutRegions.push(first);
        treatmentRegions.push(second);
      }
    }

    // If odd number of regions, assign the last one to treatment
    if (sorted.length % 2 !== 0) {
      treatmentRegions.push(sorted[sorted.length - 1]!);
    }

    const id = `geo_exp_${this.nextId++}`;
    const config: GeoExperimentConfig = {
      id,
      name,
      hypothesis,
      status: "draft",
      treatmentRegions,
      holdoutRegions,
      assignmentMethod: "matched_pairs",
      primaryMetric,
      preTestDays,
      testDays,
      cooldownDays,
      startDate: null,
      endDate: null,
      treatmentBudgetPerDay,
      results: null,
      createdAt: new Date().toISOString(),
    };

    this.experiments.set(id, config);
    return config;
  }

  /**
   * Power analysis for geo experiments.
   *
   * Uses a difference-in-differences approach accounting for
   * between-region variance. The formula considers:
   * - Number of regions (split between treatment and holdout)
   * - Baseline conversion rate per region per day
   * - Minimum detectable lift (relative effect size)
   * - Between-region variance inflation
   */
  calculateMinimumDuration(params: PowerAnalysisParams): PowerAnalysisResult {
    const {
      baselineConversionRatePerRegion,
      minimumDetectableLift,
      numberOfRegions,
      significanceLevel = 0.05,
      power = 0.8,
    } = params;

    if (numberOfRegions < 2) {
      throw new Error("At least 2 regions are required");
    }
    if (minimumDetectableLift <= 0 || minimumDetectableLift >= 1) {
      throw new Error("minimumDetectableLift must be between 0 and 1 (e.g. 0.05 for 5% lift)");
    }

    // Z-scores for significance and power
    const zAlpha = this.zScore(1 - significanceLevel / 2);
    const zBeta = this.zScore(power);

    // Number of regions per arm (treatment vs holdout)
    const regionsPerArm = Math.floor(numberOfRegions / 2);

    // Effect size: absolute change in conversion rate
    const absoluteEffect = baselineConversionRatePerRegion * minimumDetectableLift;

    // Variance of conversion rate per region per day (Poisson approximation)
    // For difference-in-differences, we need variance of the treatment effect
    // estimator, which accounts for between-region heterogeneity.
    //
    // Variance inflation factor for geo experiments:
    // sigma^2 = baseline * (1 + betweenRegionCV^2)
    // where betweenRegionCV is typically ~0.3-0.5 for geo data
    const betweenRegionCV = 0.4;
    const variancePerRegionPerDay =
      baselineConversionRatePerRegion * (1 + betweenRegionCV * betweenRegionCV);

    // Required sample days using difference-in-differences formula:
    // n_days = (z_alpha + z_beta)^2 * 2 * sigma^2 / (k * delta^2)
    // where k = number of regions per arm, delta = absolute effect
    const numerator = Math.pow(zAlpha + zBeta, 2) * 2 * variancePerRegionPerDay;
    const denominator = regionsPerArm * Math.pow(absoluteEffect, 2);

    const minimumTestDays = Math.max(7, Math.ceil(numerator / denominator));

    return {
      minimumTestDays,
      requiredEffectSize: absoluteEffect,
      regionCount: numberOfRegions,
      significanceLevel,
      power,
      assumptions: [
        `Baseline conversion rate per region per day: ${baselineConversionRatePerRegion}`,
        `Minimum detectable lift: ${(minimumDetectableLift * 100).toFixed(1)}%`,
        `Between-region CV: ${betweenRegionCV}`,
        `Regions per arm: ${regionsPerArm}`,
        `Two-sided test at alpha=${significanceLevel}`,
      ],
    };
  }

  /**
   * Analyze a completed geo experiment using difference-in-differences.
   *
   * DID estimator:
   *   lift = (treatment_test / treatment_pre) - (holdout_test / holdout_pre)
   *
   * Incremental conversions:
   *   incremental = treatment_test - (treatment_pre * holdout_ratio)
   *   where holdout_ratio = holdout_test / holdout_pre
   *
   * Statistical significance via permutation test approximation.
   */
  analyzeResults(experimentId: string, regionMetrics: GeoRegionMetrics[]): GeoExperimentResult {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const treatmentIds = new Set(experiment.treatmentRegions.map((r) => r.id));
    const holdoutIds = new Set(experiment.holdoutRegions.map((r) => r.id));

    const treatmentMetrics = regionMetrics.filter((m) => treatmentIds.has(m.regionId));
    const holdoutMetrics = regionMetrics.filter((m) => holdoutIds.has(m.regionId));

    if (treatmentMetrics.length === 0 || holdoutMetrics.length === 0) {
      throw new Error("Region metrics must include both treatment and holdout regions");
    }

    // Aggregate pre-test and test-period conversions/revenue
    const treatmentPreConversions = treatmentMetrics.reduce((s, m) => s + m.preTestConversions, 0);
    const treatmentTestConversions = treatmentMetrics.reduce((s, m) => s + m.testConversions, 0);
    const holdoutPreConversions = holdoutMetrics.reduce((s, m) => s + m.preTestConversions, 0);
    const holdoutTestConversions = holdoutMetrics.reduce((s, m) => s + m.testConversions, 0);

    const treatmentPreRevenue = treatmentMetrics.reduce((s, m) => s + m.preTestRevenue, 0);
    const treatmentTestRevenue = treatmentMetrics.reduce((s, m) => s + m.testRevenue, 0);
    const holdoutPreRevenue = holdoutMetrics.reduce((s, m) => s + m.preTestRevenue, 0);
    const holdoutTestRevenue = holdoutMetrics.reduce((s, m) => s + m.testRevenue, 0);

    // Difference-in-differences for conversions
    const treatmentRatio =
      treatmentPreConversions > 0 ? treatmentTestConversions / treatmentPreConversions : 0;
    const holdoutRatio =
      holdoutPreConversions > 0 ? holdoutTestConversions / holdoutPreConversions : 0;

    const liftPercent =
      holdoutRatio > 0 ? ((treatmentRatio - holdoutRatio) / holdoutRatio) * 100 : 0;

    // Incremental conversions: what treatment got minus what it would have
    // gotten without ads (estimated from holdout trend)
    const expectedTreatmentConversions =
      holdoutRatio > 0 ? treatmentPreConversions * holdoutRatio : 0;
    const incrementalConversions = treatmentTestConversions - expectedTreatmentConversions;

    // Same for revenue
    const holdoutRevenueRatio = holdoutPreRevenue > 0 ? holdoutTestRevenue / holdoutPreRevenue : 0;
    const expectedTreatmentRevenue =
      holdoutRevenueRatio > 0 ? treatmentPreRevenue * holdoutRevenueRatio : 0;
    const incrementalRevenue = treatmentTestRevenue - expectedTreatmentRevenue;

    // Total spend during test period
    const totalSpend = experiment.treatmentBudgetPerDay * experiment.testDays;

    // Cost per incremental conversion
    const incrementalCostPerConversion =
      incrementalConversions > 0 ? totalSpend / incrementalConversions : Infinity;

    // Incremental ROAS
    const incrementalROAS = totalSpend > 0 ? incrementalRevenue / totalSpend : null;

    // Statistical significance via permutation test approximation
    // Using the t-test approximation for difference-in-differences
    const { pValue, confidenceInterval } = this.computeSignificance(
      treatmentMetrics,
      holdoutMetrics,
      experiment.treatmentBudgetPerDay * experiment.testDays,
    );

    const confidenceLevel = 0.95;
    const significant = pValue < 1 - confidenceLevel;

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      significant,
      liftPercent,
      incrementalCostPerConversion,
      incrementalROAS,
      pValue,
    );

    const result: GeoExperimentResult = {
      treatmentMetrics,
      holdoutMetrics,
      incrementalConversions,
      incrementalRevenue,
      incrementalCostPerConversion:
        incrementalCostPerConversion === Infinity ? -1 : incrementalCostPerConversion,
      incrementalROAS,
      liftPercent,
      liftConfidenceInterval: confidenceInterval,
      pValue,
      significant,
      confidenceLevel,
      totalSpend,
      recommendation,
    };

    // Update experiment with results
    experiment.results = result;
    experiment.status = "concluded";
    this.experiments.set(experimentId, experiment);

    return result;
  }

  /**
   * Transition an experiment from draft to running.
   */
  startExperiment(experimentId: string): GeoExperimentConfig {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }
    if (experiment.status !== "draft") {
      throw new Error(`Cannot start experiment in "${experiment.status}" status — must be "draft"`);
    }

    experiment.status = "running";
    experiment.startDate = new Date().toISOString();

    // Calculate expected end date
    const totalDays = experiment.preTestDays + experiment.testDays + experiment.cooldownDays;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + totalDays);
    experiment.endDate = endDate.toISOString();

    this.experiments.set(experimentId, experiment);
    return experiment;
  }

  /**
   * Mark an experiment as concluded.
   */
  concludeExperiment(experimentId: string): GeoExperimentConfig {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }
    if (
      experiment.status !== "running" &&
      experiment.status !== "cooldown" &&
      experiment.status !== "analyzing"
    ) {
      throw new Error(
        `Cannot conclude experiment in "${experiment.status}" status — must be "running", "cooldown", or "analyzing"`,
      );
    }

    experiment.status = "concluded";
    this.experiments.set(experimentId, experiment);
    return experiment;
  }

  /**
   * List experiments with optional status filter.
   */
  listExperiments(filter?: { status?: GeoExperimentStatus }): GeoExperimentConfig[] {
    const all = Array.from(this.experiments.values());
    if (filter?.status) {
      return all.filter((e) => e.status === filter.status);
    }
    return all;
  }

  /**
   * Get a single experiment by ID.
   */
  getExperiment(experimentId: string): GeoExperimentConfig | null {
    return this.experiments.get(experimentId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute statistical significance using a permutation-test inspired
   * t-test approximation for difference-in-differences.
   */
  private computeSignificance(
    treatmentMetrics: GeoRegionMetrics[],
    holdoutMetrics: GeoRegionMetrics[],
    _totalSpend: number,
  ): {
    pValue: number;
    confidenceInterval: { lower: number; upper: number };
  } {
    // Compute per-region DID lift for each region
    const treatmentLifts = treatmentMetrics.map((m) =>
      m.preTestConversions > 0 ? m.testConversions / m.preTestConversions : 1,
    );
    const holdoutLifts = holdoutMetrics.map((m) =>
      m.preTestConversions > 0 ? m.testConversions / m.preTestConversions : 1,
    );

    const meanTreatment = this.mean(treatmentLifts);
    const meanHoldout = this.mean(holdoutLifts);
    const diffMeans = meanTreatment - meanHoldout;

    const varTreatment = this.variance(treatmentLifts);
    const varHoldout = this.variance(holdoutLifts);

    const nT = treatmentLifts.length;
    const nH = holdoutLifts.length;

    // Pooled standard error of the difference
    const se = Math.sqrt(varTreatment / nT + varHoldout / nH);

    if (se === 0) {
      // No variance — treat as perfectly significant if there is a difference
      return {
        pValue: diffMeans === 0 ? 1.0 : 0.001,
        confidenceInterval: { lower: diffMeans, upper: diffMeans },
      };
    }

    // t-statistic
    const tStat = diffMeans / se;

    // Degrees of freedom (Welch-Satterthwaite)
    const df = this.welchDF(varTreatment, nT, varHoldout, nH);

    // Two-sided p-value using t-distribution approximation
    const pValue = this.tDistributionPValue(Math.abs(tStat), df);

    // 95% confidence interval
    const tCritical = this.tCritical(0.025, df);
    const confidenceInterval = {
      lower: diffMeans - tCritical * se,
      upper: diffMeans + tCritical * se,
    };

    return { pValue, confidenceInterval };
  }

  /**
   * Generate a recommendation based on experiment results.
   */
  private generateRecommendation(
    significant: boolean,
    liftPercent: number,
    iCPA: number,
    iROAS: number | null,
    pValue: number,
  ): string {
    if (!significant) {
      if (pValue > 0.2) {
        return "No significant incremental lift detected. The advertising may not be driving measurable incremental conversions in these regions. Consider extending the test duration, increasing budget, or testing with a different audience strategy.";
      }
      return `Marginally insignificant result (p=${pValue.toFixed(3)}). Consider extending the test for more statistical power before making budget decisions.`;
    }

    if (liftPercent <= 0) {
      return "Statistically significant negative lift detected. Advertising may be cannibalizing organic conversions. Investigate potential reasons such as audience overlap, creative fatigue, or market saturation.";
    }

    const parts: string[] = [];
    parts.push(
      `Statistically significant incremental lift of ${liftPercent.toFixed(1)}% detected (p=${pValue.toFixed(3)}).`,
    );

    if (iCPA >= 0 && iCPA !== Infinity) {
      parts.push(`Incremental CPA: $${iCPA.toFixed(2)}.`);
    }

    if (iROAS !== null && iROAS > 0) {
      if (iROAS >= 3) {
        parts.push(`Strong incremental ROAS of ${iROAS.toFixed(2)}x — consider scaling budget.`);
      } else if (iROAS >= 1) {
        parts.push(
          `Positive incremental ROAS of ${iROAS.toFixed(2)}x — ads are profitable on an incremental basis.`,
        );
      } else {
        parts.push(
          `Low incremental ROAS of ${iROAS.toFixed(2)}x — ads drive lift but may not be cost-effective at current spend levels.`,
        );
      }
    }

    return parts.join(" ");
  }

  // ---------------------------------------------------------------------------
  // Math utilities
  // ---------------------------------------------------------------------------

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
    return sumSq / (values.length - 1);
  }

  /**
   * Welch-Satterthwaite degrees of freedom approximation.
   */
  private welchDF(v1: number, n1: number, v2: number, n2: number): number {
    const s1 = v1 / n1;
    const s2 = v2 / n2;
    const numerator = Math.pow(s1 + s2, 2);
    const denom = Math.pow(s1, 2) / (n1 - 1) + Math.pow(s2, 2) / (n2 - 1);
    if (denom === 0) return Math.max(n1 + n2 - 2, 1);
    return Math.max(1, Math.floor(numerator / denom));
  }

  /**
   * Inverse normal CDF approximation (Abramowitz and Stegun 26.2.23).
   */
  private zScore(p: number): number {
    if (p <= 0 || p >= 1) return 0;
    // Rational approximation
    const a1 = -3.969683028665376e1;
    const a2 = 2.209460984245205e2;
    const a3 = -2.759285104469687e2;
    const a4 = 1.38357751867269e2;
    const a5 = -3.066479806614716e1;
    const a6 = 2.506628277459239;

    const b1 = -5.447609879822406e1;
    const b2 = 1.615858368580409e2;
    const b3 = -1.556989798598866e2;
    const b4 = 6.680131188771972e1;
    const b5 = -1.328068155288572e1;

    const c1 = -7.784894002430293e-3;
    const c2 = -3.223964580411365e-1;
    const c3 = -2.400758277161838;
    const c4 = -2.549732539343734;
    const c5 = 4.374664141464968;
    const c6 = 2.938163982698783;

    const d1 = 7.784695709041462e-3;
    const d2 = 3.224671290700398e-1;
    const d3 = 2.445134137142996;
    const d4 = 3.754408661907416;

    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let q: number;
    let r: number;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
      );
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
        (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
      );
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return (
        -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
      );
    }
  }

  /**
   * Two-sided p-value from t-distribution using normal approximation
   * for large df, and a more conservative approximation for small df.
   */
  private tDistributionPValue(tAbs: number, df: number): number {
    // For large df, t-distribution approaches normal
    if (df > 30) {
      return 2 * this.normalCDF(-tAbs);
    }
    // For smaller df, use a conservative correction
    // Approximation: multiply t by sqrt(df / (df - 2)) factor adjustment
    const adjusted = tAbs * Math.sqrt((df - 2) / df);
    const p = 2 * this.normalCDF(-adjusted);
    return Math.min(1.0, p);
  }

  /**
   * Normal CDF approximation (Abramowitz and Stegun 7.1.26).
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  /**
   * Critical t-value approximation for given alpha and df.
   * Uses inverse normal as approximation for moderate-to-large df.
   */
  private tCritical(alpha: number, df: number): number {
    const z = this.zScore(1 - alpha);
    if (df > 30) return z;
    // Cornish-Fisher expansion for small df correction
    const g1 = (z * z * z + z) / 4;
    const g2 = (5 * z * z * z * z * z + 16 * z * z * z + 3 * z) / 96;
    return z + g1 / df + g2 / (df * df);
  }
}
