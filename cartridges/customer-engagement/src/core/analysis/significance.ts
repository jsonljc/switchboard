// ---------------------------------------------------------------------------
// Statistical significance for patient metric changes
// ---------------------------------------------------------------------------

/**
 * Calculate percentage change between two values.
 * Returns 0 if previous is 0 (avoids division by zero).
 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) {
    if (current === 0) return 0;
    return current > 0 ? 100 : -100;
  }
  return ((current - previous) / previous) * 100;
}

/**
 * Determines whether a period-over-period percentage change is meaningful
 * given patient volume. Higher volume = smaller changes are significant.
 *
 * Uses a heuristic: minimum detectable change scales inversely with
 * the square root of total patients (mimicking sample-size logic).
 */
export function isSignificantChange(
  deltaPercent: number,
  totalContacts: number,
  benchmarkVariance?: number,
): boolean {
  if (totalContacts <= 0) return false;

  // Use benchmark variance if available
  if (benchmarkVariance !== undefined) {
    return Math.abs(deltaPercent) > benchmarkVariance * 2;
  }

  // Fallback: patient-volume-based heuristic
  // minDetectable = 100 / sqrt(patients) — capped between 5% and 50%
  const minDetectable = Math.max(5, Math.min(50, 100 / Math.sqrt(totalContacts)));
  return Math.abs(deltaPercent) > minDetectable;
}

/**
 * Compute z-score of a value against historical values.
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
