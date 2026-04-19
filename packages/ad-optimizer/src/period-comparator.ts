// packages/core/src/ad-optimizer/period-comparator.ts
import type {
  MetricDeltaSchema as MetricDelta,
  MetricDirectionSchema as MetricDirection,
} from "@switchboard/schemas";

// ── Types ──

export interface MetricSet {
  cpm: number;
  ctr: number;
  cpc: number;
  cpl: number;
  cpa: number;
  roas: number;
  frequency: number;
}

// ── Constants ──

const SIGNIFICANCE_THRESHOLD = 0.15; // 15%
const STABLE_THRESHOLD = 1; // |deltaPercent| <= 1 → stable

// ── Helpers ──

function computeDelta(metric: string, current: number, previous: number): MetricDelta {
  let deltaPercent: number;
  let direction: MetricDirection;
  let significant: boolean;

  if (previous === 0) {
    deltaPercent = current === 0 ? 0 : 100;
    direction = current === 0 ? "stable" : "up";
    significant = current !== 0;
  } else {
    deltaPercent = ((current - previous) / previous) * 100;
    const abs = Math.abs(deltaPercent);
    direction = abs <= STABLE_THRESHOLD ? "stable" : deltaPercent > 0 ? "up" : "down";
    significant = abs > SIGNIFICANCE_THRESHOLD * 100;
  }

  return { metric, current, previous, deltaPercent, direction, significant };
}

// ── Main export ──

export function comparePeriods(current: MetricSet, previous: MetricSet): MetricDelta[] {
  const metrics: (keyof MetricSet)[] = ["cpm", "ctr", "cpc", "cpl", "cpa", "roas", "frequency"];
  return metrics.map((key) => computeDelta(key, current[key], previous[key]));
}
