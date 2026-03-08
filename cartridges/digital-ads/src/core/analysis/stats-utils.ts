// ---------------------------------------------------------------------------
// Shared statistical utility functions
// ---------------------------------------------------------------------------
// Provides core statistical primitives used by significance.ts,
// testing-queue.ts, and other analysis modules.
// ---------------------------------------------------------------------------

/**
 * Approximate inverse of the standard normal CDF (probit function).
 * Uses Abramowitz & Stegun rational approximation (formula 26.2.23).
 * Accurate to ~4.5e-4 absolute error.
 */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error("p must be between 0 and 1 exclusive");
  }

  // Symmetry: if p > 0.5, flip
  const sign = p < 0.5 ? -1 : 1;
  const pAdj = p < 0.5 ? p : 1 - p;

  const t = Math.sqrt(-2 * Math.log(pAdj));

  // Coefficients for rational approximation
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  const z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);

  return sign * z;
}

/**
 * Error function approximation (Horner form of Abramowitz & Stegun 7.1.26).
 * Maximum error: ~1.5e-7.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);

  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1 / (1 + p * a);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-a * a);

  return sign * y;
}

/**
 * Standard normal CDF: Phi(z) = 0.5 * (1 + erf(z / sqrt(2)))
 */
export function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Chi-squared CDF approximation for any degrees of freedom.
 *
 * For df=1, uses the exact relationship:
 *   chi2_cdf(x, 1) = 2 * Phi(sqrt(x)) - 1 = erf(sqrt(x/2))
 *
 * For df>1, uses the Wilson-Hilferty normal approximation:
 *   z = ((x/df)^(1/3) - (1 - 2/(9*df))) / sqrt(2/(9*df))
 *   chi2_cdf(x, df) ≈ Phi(z)
 */
export function chi2CDF(x: number, df: number): number {
  if (x <= 0) return 0;
  if (df <= 0) return 0;

  if (df === 1) {
    // Exact for df=1
    return erf(Math.sqrt(x / 2));
  }

  // Wilson-Hilferty normal approximation
  const cube = Math.pow(x / df, 1 / 3);
  const mean = 1 - 2 / (9 * df);
  const stddev = Math.sqrt(2 / (9 * df));
  const z = (cube - mean) / stddev;

  return normalCDF(z);
}

/**
 * Compute the Wilson score confidence interval for a proportion.
 *
 * The Wilson score interval is preferred over the Wald interval because
 * it has better coverage probability, especially for small samples or
 * proportions near 0 or 1.
 *
 * @param successes Number of successes (e.g., conversions, clicks)
 * @param total     Total number of trials (e.g., impressions, visitors)
 * @param z         Z-score for the desired confidence level (e.g., 1.96 for 95%)
 */
export function wilsonScoreInterval(
  successes: number,
  total: number,
  z: number,
): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 0 };

  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));

  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}
