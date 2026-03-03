// ---------------------------------------------------------------------------
// Statistical significance for metric changes
// ---------------------------------------------------------------------------

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
