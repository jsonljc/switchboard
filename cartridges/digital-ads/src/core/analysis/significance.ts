// ---------------------------------------------------------------------------
// Statistical significance for metric changes
// ---------------------------------------------------------------------------

import {
  normalQuantile,
  chi2CDF,
  normalCDF,
  wilsonScoreInterval,
} from "./stats-utils.js";

/**
 * Determines whether a WoW percentage change is statistically meaningful
 * given the spend volume. Higher spend = smaller changes are significant.
 *
 * Uses a simple heuristic: the minimum detectable change scales inversely
 * with the square root of spend (mimicking sample-size logic).
 *
 * At $100/day spend, a ~30% change is the minimum signal.
 * At $1,000/day, ~10%.
 * At $10,000/day, ~3%.
 */
export function isSignificantChange(
  deltaPercent: number,
  spend: number,
  benchmarkVariance?: number,
): boolean {
  if (spend <= 0) return false;

  // Use benchmark variance if available (account-specific or vertical default)
  if (benchmarkVariance !== undefined) {
    // Flag if the change exceeds 2x the normal variance
    return Math.abs(deltaPercent) > benchmarkVariance * 2;
  }

  // Fallback: spend-based heuristic
  // minDetectable = 100 / sqrt(spend) — capped between 5% and 50%
  const minDetectable = Math.max(5, Math.min(50, 100 / Math.sqrt(spend)));
  return Math.abs(deltaPercent) > minDetectable;
}

/**
 * Compute z-score of a value against a set of historical values.
 * Returns null if not enough data.
 */
export function zScore(value: number, history: number[]): number | null {
  if (history.length < 3) return null;

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / history.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return value === mean ? 0 : null;
  return (value - mean) / stdDev;
}

/**
 * Calculate percentage change between two values.
 * Returns 0 if previous is 0 (avoids division by zero).
 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) {
    if (current === 0) return 0;
    return current > 0 ? 100 : -100; // went from nothing to something
  }
  return ((current - previous) / previous) * 100;
}

// ---------------------------------------------------------------------------
// Rigorous statistical significance tests
// ---------------------------------------------------------------------------

/**
 * Chi-squared test for independence on a 2xN contingency table.
 *
 * Given observed counts in a 2D array (rows = groups, columns = categories),
 * tests whether the row variable is independent of the column variable.
 *
 * If `expected` is not provided, expected values are computed from the
 * marginal totals (standard chi-squared test of independence).
 *
 * @param observed  2D array of observed counts — each inner array is a row
 * @param expected  Optional 2D array of expected counts (same shape as observed)
 * @returns         Chi-squared statistic, degrees of freedom, p-value, and significance flag
 */
export function chiSquaredTest(
  observed: number[][],
  expected?: number[][],
): { chiSquared: number; df: number; pValue: number; significant: boolean } {
  const numRows = observed.length;
  if (numRows === 0) {
    return { chiSquared: 0, df: 0, pValue: 1, significant: false };
  }
  const numCols = observed[0]!.length;
  if (numCols === 0) {
    return { chiSquared: 0, df: 0, pValue: 1, significant: false };
  }

  // Compute expected values from marginals if not provided
  let exp: number[][];
  if (expected) {
    exp = expected;
  } else {
    const rowTotals = observed.map((row) => row.reduce((s, v) => s + v, 0));
    const colTotals: number[] = [];
    for (let j = 0; j < numCols; j++) {
      let colSum = 0;
      for (let i = 0; i < numRows; i++) {
        colSum += observed[i]![j]!;
      }
      colTotals.push(colSum);
    }
    const grandTotal = rowTotals.reduce((s, v) => s + v, 0);

    if (grandTotal === 0) {
      return { chiSquared: 0, df: 0, pValue: 1, significant: false };
    }

    exp = observed.map((_, i) =>
      Array.from({ length: numCols }, (_, j) =>
        (rowTotals[i]! * colTotals[j]!) / grandTotal,
      ),
    );
  }

  // Compute chi-squared statistic
  let chiSq = 0;
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      const o = observed[i]![j]!;
      const e = exp[i]![j]!;
      if (e > 0) {
        chiSq += Math.pow(o - e, 2) / e;
      }
    }
  }

  const df = (numRows - 1) * (numCols - 1);
  if (df === 0) {
    return { chiSquared: chiSq, df: 0, pValue: 1, significant: false };
  }

  // P-value from chi-squared distribution
  const pValue = Math.max(0, Math.min(1, 1 - chi2CDF(chiSq, df)));

  return {
    chiSquared: chiSq,
    df,
    pValue,
    significant: pValue < 0.05,
  };
}

/**
 * Two-proportion z-test for comparing conversion rates between two groups.
 *
 * Uses the pooled proportion under the null hypothesis of equal rates
 * to compute the standard error, then derives a two-tailed p-value.
 *
 * Also returns the confidence interval for the difference in proportions
 * (p1 - p2) using the unpooled standard error.
 *
 * @param successes1  Number of successes in group 1
 * @param total1      Total observations in group 1
 * @param successes2  Number of successes in group 2
 * @param total2      Total observations in group 2
 * @param alpha       Significance level (default 0.05)
 */
export function proportionTest(
  successes1: number,
  total1: number,
  successes2: number,
  total2: number,
  alpha: number = 0.05,
): {
  zStatistic: number;
  pValue: number;
  significant: boolean;
  confidenceInterval: { lower: number; upper: number };
} {
  if (total1 === 0 || total2 === 0) {
    return {
      zStatistic: 0,
      pValue: 1,
      significant: false,
      confidenceInterval: { lower: 0, upper: 0 },
    };
  }

  const p1 = successes1 / total1;
  const p2 = successes2 / total2;
  const diff = p1 - p2;

  // Pooled proportion under H0: p1 = p2
  const pooledP = (successes1 + successes2) / (total1 + total2);

  // Standard error using pooled proportion (for the test statistic)
  const pooledSE = Math.sqrt(pooledP * (1 - pooledP) * (1 / total1 + 1 / total2));

  if (pooledSE === 0) {
    return {
      zStatistic: 0,
      pValue: 1,
      significant: false,
      confidenceInterval: { lower: 0, upper: 0 },
    };
  }

  const zStat = diff / pooledSE;

  // Two-tailed p-value
  const pValue = 2 * (1 - normalCDF(Math.abs(zStat)));

  // Confidence interval using unpooled standard error
  const unpooledSE = Math.sqrt(
    (p1 * (1 - p1)) / total1 + (p2 * (1 - p2)) / total2,
  );
  const zCrit = normalQuantile(1 - alpha / 2);

  return {
    zStatistic: zStat,
    pValue: Math.max(0, Math.min(1, pValue)),
    significant: pValue < alpha,
    confidenceInterval: {
      lower: diff - zCrit * unpooledSE,
      upper: diff + zCrit * unpooledSE,
    },
  };
}

/**
 * Calculate the minimum sample size per group needed to detect a given
 * effect in a two-proportion z-test.
 *
 * Uses the standard formula:
 *   n = (Z_{alpha/2} + Z_beta)^2 * (p1*(1-p1) + p2*(1-p2)) / (p1 - p2)^2
 *
 * @param baselineRate            Baseline conversion rate (e.g., 0.02 for 2%)
 * @param minimumDetectableEffect Absolute difference to detect (e.g., 0.005 for 0.5pp)
 * @param alpha                   Significance level (default 0.05)
 * @param power                   Statistical power, 1 - beta (default 0.80)
 * @returns                       Minimum sample size per group (rounded up)
 */
export function minimumSampleSize(
  baselineRate: number,
  minimumDetectableEffect: number,
  alpha: number = 0.05,
  power: number = 0.80,
): number {
  if (minimumDetectableEffect === 0) return Infinity;

  const p1 = baselineRate;
  const p2 = baselineRate + minimumDetectableEffect;

  const zAlpha = normalQuantile(1 - alpha / 2);
  const zBeta = normalQuantile(power);

  const numerator = Math.pow(zAlpha + zBeta, 2) * (p1 * (1 - p1) + p2 * (1 - p2));
  const denominator = Math.pow(p1 - p2, 2);

  return Math.ceil(numerator / denominator);
}

/**
 * Wilson score confidence interval for a single proportion.
 *
 * Preferred over the Wald interval because it maintains correct coverage
 * probability even for small samples or proportions near 0 or 1.
 *
 * @param rate             Observed proportion (successes / sampleSize)
 * @param sampleSize       Number of observations
 * @param confidenceLevel  Desired confidence level (default 0.95)
 * @returns                Lower bound, upper bound, and margin of error
 */
export function confidenceInterval(
  rate: number,
  sampleSize: number,
  confidenceLevel: number = 0.95,
): { lower: number; upper: number; marginOfError: number } {
  if (sampleSize === 0) {
    return { lower: 0, upper: 0, marginOfError: 0 };
  }

  const z = normalQuantile(1 - (1 - confidenceLevel) / 2);
  const successes = Math.round(rate * sampleSize);
  const interval = wilsonScoreInterval(successes, sampleSize, z);

  const marginOfError = (interval.upper - interval.lower) / 2;

  return {
    lower: interval.lower,
    upper: interval.upper,
    marginOfError,
  };
}

/**
 * Checks whether there is adequate sample size to trust a statistical result.
 *
 * Rules:
 *   - At least `minimumConversions` conversions (default: 30) — ensures
 *     the normal approximation to the binomial is reasonable.
 *   - At least 100 impressions — guards against tiny denominators.
 *
 * @param conversions         Number of observed conversions (successes)
 * @param impressions         Number of total impressions (trials)
 * @param minimumConversions  Minimum conversion count threshold (default 30)
 */
export function isAdequateSampleSize(
  conversions: number,
  impressions: number,
  minimumConversions: number = 30,
): boolean {
  return conversions >= minimumConversions && impressions >= 100;
}

/**
 * Adjust a p-value for multiple comparisons to control the family-wise
 * error rate (FWER).
 *
 * Supports two methods:
 *   - **Bonferroni**: Multiplies the p-value by the number of comparisons.
 *     Simple and conservative.
 *   - **Holm** (Holm-Bonferroni): Step-down procedure that is uniformly
 *     more powerful than Bonferroni. For a single p-value, this adjusts as:
 *     adjustedP = p * numComparisons (same as Bonferroni for a single test,
 *     but the Holm procedure is intended for ordered sets of p-values).
 *
 * @param pValue          The raw (unadjusted) p-value
 * @param numComparisons  Number of simultaneous comparisons being made
 * @param method          Correction method: 'bonferroni' or 'holm' (default 'bonferroni')
 * @returns               Adjusted p-value and significance flag at alpha=0.05
 */
export function adjustedSignificance(
  pValue: number,
  numComparisons: number,
  method: "bonferroni" | "holm" = "bonferroni",
): { adjustedPValue: number; significant: boolean } {
  if (numComparisons <= 0) {
    return { adjustedPValue: pValue, significant: pValue < 0.05 };
  }

  let adjustedPValue: number;

  switch (method) {
    case "bonferroni":
      adjustedPValue = Math.min(1, pValue * numComparisons);
      break;

    case "holm":
      // For a single p-value, Holm step-down gives the same result as
      // Bonferroni: adjusted_p = p * k where k is the number of tests.
      // The full Holm procedure requires an ordered set of p-values;
      // here we handle the single-p-value case which is the most common
      // usage pattern (testing one comparison at a time within a loop).
      adjustedPValue = Math.min(1, pValue * numComparisons);
      break;
  }

  return {
    adjustedPValue,
    significant: adjustedPValue < 0.05,
  };
}
