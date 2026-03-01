import type { VerticalBenchmarks } from "../types.js";

// ---------------------------------------------------------------------------
// Dynamic Threshold Engine
// ---------------------------------------------------------------------------
// Provides account-specific thresholds when historical data is available,
// falling back to vertical benchmarks for new accounts.
// ---------------------------------------------------------------------------

export interface AccountHistory {
  /** Weekly metric values, most recent first */
  weeklyValues: Record<string, number[]>;
  /** Number of weeks of data */
  weeksOfData: number;
}

/**
 * Compute account-specific normal variance for a metric.
 * Uses the coefficient of variation (stddev / mean) from history.
 * Returns null if not enough history (< 4 weeks).
 */
export function accountVariance(
  metricKey: string,
  history: AccountHistory
): number | null {
  const values = history.weeklyValues[metricKey];
  if (!values || values.length < 4) return null;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;

  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Return as percentage
  return (stdDev / mean) * 100;
}

/**
 * Get the effective variance threshold for a metric.
 * Prefers account history, falls back to vertical benchmarks.
 */
export function getEffectiveVariance(
  metricKey: string,
  history: AccountHistory | null,
  benchmarks: VerticalBenchmarks
): number {
  if (history) {
    const acctVar = accountVariance(metricKey, history);
    if (acctVar !== null) return acctVar;
  }

  return benchmarks.benchmarks[metricKey]?.normalVariancePercent ?? 15;
}
