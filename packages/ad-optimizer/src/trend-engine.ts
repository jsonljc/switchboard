import type {
  MetricSnapshotSchema as MetricSnapshot,
  MetricTrendSchema as MetricTrend,
  TrendTierSchema as TrendTier,
} from "@switchboard/schemas";

const METRIC_KEYS: (keyof MetricSnapshot)[] = ["cpm", "ctr", "cpc", "cpl", "cpa", "roas"];

/**
 * Classify a trend tier based on how many consecutive weeks the metric
 * has been moving in the same direction.
 */
export function classifyTrendTier(consecutiveWeeks: number): TrendTier {
  if (consecutiveWeeks === 0) return "stable";
  if (consecutiveWeeks <= 2) return "alert";
  return "confirmed";
}

/**
 * Detect week-over-week trends for each metric across an ordered array
 * of weekly snapshots. Counts consecutive same-direction movements
 * from the END of the array backward.
 */
export function detectTrends(weeklySnapshots: MetricSnapshot[]): MetricTrend[] {
  return METRIC_KEYS.map((metric) => {
    const values = weeklySnapshots.map((s) => s[metric]);
    const { direction, consecutiveWeeks } = countConsecutive(values);
    const tier = classifyTrendTier(consecutiveWeeks);
    return { metric, direction, consecutiveWeeks, tier, projectedBreachWeeks: null };
  });
}

function countConsecutive(values: number[]): {
  direction: "rising" | "falling" | "stable";
  consecutiveWeeks: number;
} {
  if (values.length < 2) return { direction: "stable", consecutiveWeeks: 0 };

  let count = 0;
  let lastDirection: "rising" | "falling" | null = null;

  // Walk backward from the end
  for (let i = values.length - 1; i > 0; i--) {
    const cur = values[i]!;
    const prev = values[i - 1]!;
    const diff = cur - prev;
    if (diff === 0) break;

    const dir: "rising" | "falling" = diff > 0 ? "rising" : "falling";
    if (lastDirection === null) {
      lastDirection = dir;
      count = 1;
    } else if (dir === lastDirection) {
      count++;
    } else {
      break;
    }
  }

  if (count < 2) return { direction: "stable", consecutiveWeeks: 0 };
  return { direction: lastDirection!, consecutiveWeeks: count };
}

/**
 * Project weeks until a metric breaches a target using linear
 * extrapolation from the last 2 data points.
 *
 * - Cost metrics breach when value rises above the target.
 * - Performance metrics breach when value falls below the target.
 *
 * Returns null if already breached, not trending toward breach,
 * fewer than 2 data points, or the trend is flat.
 */
export function projectBreach(
  weeklyValues: number[],
  target: number,
  metricType: "cost" | "performance",
): number | null {
  if (weeklyValues.length < 2) return null;

  const current = weeklyValues[weeklyValues.length - 1]!;
  const previous = weeklyValues[weeklyValues.length - 2]!;
  const delta = current - previous;

  if (delta === 0) return null;

  if (metricType === "cost") {
    // Already at or above target — already breached
    if (current >= target) return null;
    // Must be trending up toward target
    if (delta <= 0) return null;
    return Math.ceil((target - current) / delta);
  }

  // performance
  // Already at or below target — already breached
  if (current <= target) return null;
  // Must be trending down toward target
  if (delta >= 0) return null;
  return Math.ceil((current - target) / Math.abs(delta));
}
