// ---------------------------------------------------------------------------
// Creative Testing Queue — Automated creative testing pipeline
// ---------------------------------------------------------------------------
// Manages a systematic creative testing pipeline with a test calendar,
// statistical power calculator, and winner declaration system.
// ---------------------------------------------------------------------------

import {
  normalQuantile,
  chi2CDF,
  wilsonScoreInterval,
} from "../core/analysis/stats-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreativeTestSlot {
  id: string;
  name: string;
  hypothesis: string;
  variants: Array<{
    variantId: string;
    description: string;
    adId?: string; // Meta ad ID once launched
  }>;
  primaryMetric: "cpa" | "ctr" | "conversion_rate" | "roas";
  status: "queued" | "running" | "concluded" | "cancelled";
  scheduledStartDate: string | null;
  actualStartDate: string | null;
  endDate: string | null;
  minBudgetPerVariant: number;
  winnerId: string | null;
  results: CreativeTestResult | null;
}

export interface CreativeTestResult {
  variants: Array<{
    variantId: string;
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    primaryMetricValue: number;
    confidenceInterval: { lower: number; upper: number };
  }>;
  statisticalSignificance: boolean;
  pValue: number;
  confidenceLevel: number;
  winnerVariantId: string | null;
  recommendation: string;
}

export interface TestCalendarEntry {
  weekNumber: number;
  startDate: string;
  testSlot: CreativeTestSlot | null;
  status: "available" | "occupied" | "blocked";
  blockReason?: string;
}

export interface PowerCalculation {
  requiredSamplesPerVariant: number;
  estimatedDaysToReach: number;
  estimatedBudgetPerVariant: number;
  totalEstimatedBudget: number;
  baselineRate: number;
  minimumDetectableEffect: number;
  statisticalPower: number;
  significanceLevel: number;
}

export interface VariantMetrics {
  variantId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
}

// ---------------------------------------------------------------------------
// CreativeTestingQueue
// ---------------------------------------------------------------------------

export class CreativeTestingQueue {
  private readonly tests = new Map<string, CreativeTestSlot>();

  /**
   * Statistical power calculator.
   *
   * Uses the standard two-proportion z-test formula:
   *   n = (Z_alpha/2 + Z_beta)^2 * (p1(1-p1) + p2(1-p2)) / (p1 - p2)^2
   *
   * @param params.baselineRate          Baseline conversion rate (e.g. 0.02 for 2%)
   * @param params.minimumDetectableEffect Relative lift to detect (e.g. 0.10 for 10% lift)
   * @param params.significanceLevel     Alpha, default 0.05
   * @param params.power                 1 - beta, default 0.80
   * @param params.numVariants           Number of variants including control, default 2
   * @param params.estimatedDailyTraffic Estimated impressions or visitors per variant per day
   * @param params.estimatedCPM          Estimated cost per 1000 impressions (for budget calc)
   */
  calculatePower(params: {
    baselineRate: number;
    minimumDetectableEffect: number;
    significanceLevel?: number;
    power?: number;
    numVariants?: number;
    estimatedDailyTraffic?: number;
    estimatedCPM?: number;
  }): PowerCalculation {
    const alpha = params.significanceLevel ?? 0.05;
    const beta = 1 - (params.power ?? 0.80);
    const numVariants = params.numVariants ?? 2;
    const dailyTraffic = params.estimatedDailyTraffic ?? 1000;
    const cpm = params.estimatedCPM ?? 10;

    const p1 = params.baselineRate;
    const absoluteEffect = p1 * params.minimumDetectableEffect;
    const p2 = p1 + absoluteEffect;

    // Bonferroni correction for multiple comparisons (k-1 comparisons vs control)
    const adjustedAlpha = alpha / Math.max(1, numVariants - 1);

    const zAlpha = normalQuantile(1 - adjustedAlpha / 2);
    const zBeta = normalQuantile(1 - beta);

    // Standard two-proportion sample size formula
    const numerator = Math.pow(zAlpha + zBeta, 2) * (p1 * (1 - p1) + p2 * (1 - p2));
    const denominator = Math.pow(p1 - p2, 2);

    const requiredSamplesPerVariant = Math.ceil(numerator / denominator);
    const estimatedDaysToReach = Math.ceil(requiredSamplesPerVariant / dailyTraffic);
    const estimatedBudgetPerVariant = (requiredSamplesPerVariant / 1000) * cpm;
    const totalEstimatedBudget = estimatedBudgetPerVariant * numVariants;

    return {
      requiredSamplesPerVariant,
      estimatedDaysToReach,
      estimatedBudgetPerVariant,
      totalEstimatedBudget,
      baselineRate: p1,
      minimumDetectableEffect: params.minimumDetectableEffect,
      statisticalPower: params.power ?? 0.80,
      significanceLevel: alpha,
    };
  }

  /**
   * Add a test to the queue.
   */
  queueTest(
    slot: Omit<CreativeTestSlot, "id" | "status" | "actualStartDate" | "endDate" | "winnerId" | "results">,
  ): CreativeTestSlot {
    const id = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const test: CreativeTestSlot = {
      ...slot,
      id,
      status: "queued",
      actualStartDate: null,
      endDate: null,
      winnerId: null,
      results: null,
    };
    this.tests.set(id, test);
    return test;
  }

  /**
   * Generate a test calendar showing the next N weeks with scheduled/available slots.
   */
  getCalendar(weeks: number): TestCalendarEntry[] {
    const calendar: TestCalendarEntry[] = [];
    const now = new Date();

    // Start from the beginning of the current week (Monday)
    const startOfWeek = new Date(now);
    const dayOfWeek = startOfWeek.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfWeek.setDate(startOfWeek.getDate() + mondayOffset);
    startOfWeek.setHours(0, 0, 0, 0);

    // Collect all tests by their scheduled start date
    const testsByWeek = new Map<string, CreativeTestSlot>();
    for (const test of this.tests.values()) {
      if (test.status === "cancelled") continue;
      if (test.scheduledStartDate) {
        const testStart = new Date(test.scheduledStartDate);
        // Normalize to the Monday of that week
        const testDay = testStart.getDay();
        const testMondayOffset = testDay === 0 ? -6 : 1 - testDay;
        testStart.setDate(testStart.getDate() + testMondayOffset);
        testStart.setHours(0, 0, 0, 0);
        testsByWeek.set(testStart.toISOString().split("T")[0]!, test);
      }
    }

    // Also map running tests (that have an actual start date) to their weeks
    for (const test of this.tests.values()) {
      if (test.status !== "running") continue;
      if (test.actualStartDate) {
        const testStart = new Date(test.actualStartDate);
        const testDay = testStart.getDay();
        const testMondayOffset = testDay === 0 ? -6 : 1 - testDay;
        testStart.setDate(testStart.getDate() + testMondayOffset);
        testStart.setHours(0, 0, 0, 0);
        const weekKey = testStart.toISOString().split("T")[0]!;
        if (!testsByWeek.has(weekKey)) {
          testsByWeek.set(weekKey, test);
        }
      }
    }

    for (let w = 0; w < weeks; w++) {
      const weekStart = new Date(startOfWeek);
      weekStart.setDate(weekStart.getDate() + w * 7);
      const weekKey = weekStart.toISOString().split("T")[0]!;

      const test = testsByWeek.get(weekKey) ?? null;
      let status: TestCalendarEntry["status"] = "available";
      if (test) {
        status = "occupied";
      }

      calendar.push({
        weekNumber: w + 1,
        startDate: weekKey,
        testSlot: test,
        status,
      });
    }

    return calendar;
  }

  /**
   * Evaluate a running test for statistical significance.
   *
   * Performs a chi-squared test for conversion rate comparisons and
   * computes Wilson score confidence intervals for each variant.
   */
  evaluateTest(
    testId: string,
    variantMetrics: VariantMetrics[],
  ): CreativeTestResult {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }
    if (test.status !== "running" && test.status !== "queued") {
      throw new Error(`Test ${testId} is not in a running or queued state (current: ${test.status})`);
    }

    const confidenceLevel = 0.95;
    const z = normalQuantile(1 - (1 - confidenceLevel) / 2); // ~1.96

    // Compute primary metric value and confidence interval for each variant
    const variantResults = variantMetrics.map((vm) => {
      const metricResult = this.computeMetricForVariant(test.primaryMetric, vm, z);
      return {
        variantId: vm.variantId,
        impressions: vm.impressions,
        clicks: vm.clicks,
        conversions: vm.conversions,
        spend: vm.spend,
        primaryMetricValue: metricResult.value,
        confidenceInterval: metricResult.ci,
      };
    });

    // Chi-squared test for independence (conversion rates)
    // Generalized for N variants:
    // Build a 2xN contingency table: [conversions, non-conversions] x [variants]
    const { chiSquared: _chiSquared, pValue } = this.chiSquaredTest(variantMetrics, test.primaryMetric);
    const statisticalSignificance = pValue < (1 - confidenceLevel);

    // Determine winner: the variant with the best primary metric value
    let winnerVariantId: string | null = null;
    let recommendation: string;

    if (statisticalSignificance) {
      const sorted = [...variantResults].sort((a, b) => {
        // Lower is better for CPA; higher is better for CTR, conversion_rate, ROAS
        if (test.primaryMetric === "cpa") {
          return a.primaryMetricValue - b.primaryMetricValue;
        }
        return b.primaryMetricValue - a.primaryMetricValue;
      });

      winnerVariantId = sorted[0]?.variantId ?? null;
      const winnerResult = sorted[0];
      const runnerUp = sorted[1];

      if (winnerResult && runnerUp) {
        const lift = test.primaryMetric === "cpa"
          ? ((runnerUp.primaryMetricValue - winnerResult.primaryMetricValue) / runnerUp.primaryMetricValue * 100)
          : ((winnerResult.primaryMetricValue - runnerUp.primaryMetricValue) / runnerUp.primaryMetricValue * 100);

        recommendation = `Winner: variant "${winnerVariantId}" with ${test.primaryMetric} = ${winnerResult.primaryMetricValue.toFixed(4)} ` +
          `(${lift.toFixed(1)}% better than runner-up, p=${pValue.toFixed(4)}). ` +
          `Scale the winner and pause losing variants.`;
      } else {
        recommendation = `Winner: variant "${winnerVariantId}" with statistical significance (p=${pValue.toFixed(4)}).`;
      }
    } else {
      recommendation = `No statistically significant winner yet (p=${pValue.toFixed(4)}). ` +
        `Continue running the test to gather more data, or consider increasing budget/traffic.`;
    }

    const result: CreativeTestResult = {
      variants: variantResults,
      statisticalSignificance,
      pValue,
      confidenceLevel,
      winnerVariantId,
      recommendation,
    };

    // Update the test slot with results
    test.results = result;
    if (statisticalSignificance) {
      test.winnerId = winnerVariantId;
    }

    return result;
  }

  /**
   * Mark a test as concluded and record the winner.
   */
  concludeTest(testId: string): CreativeTestSlot {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }
    if (test.status === "concluded") {
      throw new Error(`Test ${testId} is already concluded`);
    }
    if (test.status === "cancelled") {
      throw new Error(`Test ${testId} is cancelled and cannot be concluded`);
    }

    test.status = "concluded";
    test.endDate = new Date().toISOString();

    return test;
  }

  /**
   * List all tests, optionally filtered by status.
   */
  listTests(filter?: { status?: CreativeTestSlot["status"] }): CreativeTestSlot[] {
    const all = Array.from(this.tests.values());
    if (filter?.status) {
      return all.filter((t) => t.status === filter.status);
    }
    return all;
  }

  /**
   * Start a queued test (set status to running with actualStartDate).
   */
  startTest(testId: string): CreativeTestSlot {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }
    if (test.status !== "queued") {
      throw new Error(`Test ${testId} is not queued (current: ${test.status})`);
    }
    test.status = "running";
    test.actualStartDate = new Date().toISOString();
    return test;
  }

  /**
   * Cancel a queued or running test.
   */
  cancelTest(testId: string): CreativeTestSlot {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test not found: ${testId}`);
    }
    if (test.status === "concluded") {
      throw new Error(`Test ${testId} is already concluded and cannot be cancelled`);
    }
    test.status = "cancelled";
    test.endDate = new Date().toISOString();
    return test;
  }

  /**
   * Get a single test by ID.
   */
  getTest(testId: string): CreativeTestSlot | null {
    return this.tests.get(testId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private computeMetricForVariant(
    metric: CreativeTestSlot["primaryMetric"],
    vm: VariantMetrics,
    z: number,
  ): { value: number; ci: { lower: number; upper: number } } {
    switch (metric) {
      case "ctr": {
        const rate = vm.impressions > 0 ? vm.clicks / vm.impressions : 0;
        const ci = wilsonScoreInterval(vm.clicks, vm.impressions, z);
        return { value: rate, ci };
      }
      case "conversion_rate": {
        const rate = vm.clicks > 0 ? vm.conversions / vm.clicks : 0;
        const ci = wilsonScoreInterval(vm.conversions, vm.clicks, z);
        return { value: rate, ci };
      }
      case "cpa": {
        const cpa = vm.conversions > 0 ? vm.spend / vm.conversions : Infinity;
        // For CPA, use a bootstrap-inspired heuristic CI
        if (vm.conversions === 0) {
          return { value: cpa, ci: { lower: 0, upper: Infinity } };
        }
        // Approximate CI using the conversion rate CI inverted
        const costPerClick = vm.clicks > 0 ? vm.spend / vm.clicks : 0;
        const ci = wilsonScoreInterval(vm.conversions, vm.clicks, z);
        return {
          value: cpa,
          ci: {
            lower: ci.upper > 0 ? costPerClick / ci.upper : 0,
            upper: ci.lower > 0 ? costPerClick / ci.lower : Infinity,
          },
        };
      }
      case "roas": {
        // ROAS = revenue / spend. We approximate with conversions as a proxy
        // In practice this would use revenue data; here we use conversion-based approximation
        const roas = vm.spend > 0 ? vm.conversions / vm.spend : 0;
        const rate = vm.spend > 0 ? vm.conversions / vm.spend : 0;
        // Approximate CI
        if (vm.conversions === 0 || vm.spend === 0) {
          return { value: roas, ci: { lower: 0, upper: 0 } };
        }
        const ci = wilsonScoreInterval(vm.conversions, Math.ceil(vm.spend), z);
        return { value: rate, ci };
      }
    }
  }

  /**
   * Perform a chi-squared test for independence on variant metrics.
   *
   * Constructs a 2xN contingency table based on the primary metric:
   *   - conversion_rate or cpa: [conversions, non-conversions (clicks-conversions)]
   *   - ctr: [clicks, non-clicks (impressions-clicks)]
   *   - roas: [conversions, non-conversions from spend units]
   *
   * Returns chi-squared statistic and approximate p-value.
   */
  private chiSquaredTest(
    variantMetrics: VariantMetrics[],
    metric: CreativeTestSlot["primaryMetric"],
  ): { chiSquared: number; pValue: number } {
    if (variantMetrics.length < 2) {
      return { chiSquared: 0, pValue: 1 };
    }

    // Build the contingency table rows: [successes, failures] per variant
    const observed: Array<[number, number]> = variantMetrics.map((vm) => {
      switch (metric) {
        case "ctr":
          return [vm.clicks, Math.max(0, vm.impressions - vm.clicks)];
        case "conversion_rate":
        case "cpa":
          return [vm.conversions, Math.max(0, vm.clicks - vm.conversions)];
        case "roas":
          return [vm.conversions, Math.max(0, Math.ceil(vm.spend) - vm.conversions)];
      }
    });

    // Compute totals
    const rowTotals = observed.map(([a, b]) => a + b);
    const grandTotal = rowTotals.reduce((s, v) => s + v, 0);

    if (grandTotal === 0) {
      return { chiSquared: 0, pValue: 1 };
    }

    const colTotals = [
      observed.reduce((s, [a]) => s + a, 0),
      observed.reduce((s, [, b]) => s + b, 0),
    ];

    // Compute chi-squared statistic
    let chiSquared = 0;
    for (let i = 0; i < observed.length; i++) {
      for (let j = 0; j < 2; j++) {
        const observedVal = observed[i]![j]!;
        const expectedVal = (rowTotals[i]! * colTotals[j]!) / grandTotal;
        if (expectedVal > 0) {
          chiSquared += Math.pow(observedVal - expectedVal, 2) / expectedVal;
        }
      }
    }

    // Degrees of freedom = (rows - 1) * (cols - 1) = (N - 1) * 1
    // For 2 variants this is chi2 with df=1
    // For N>2 variants, we use a pairwise approach with the control (first variant)
    // as a simplification, computing p-value from df=1 (most conservative pair)
    // A full implementation would use chi2 with df=N-1, but for a practical creative
    // test with 2-4 variants, this is adequate.
    const df = variantMetrics.length - 1;

    // Approximate p-value using chi-squared distribution
    let pValue = 1 - chi2CDF(chiSquared, df);

    // Clamp p-value
    pValue = Math.max(0, Math.min(1, pValue));

    return { chiSquared, pValue };
  }
}
