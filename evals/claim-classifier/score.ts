import type { Baseline, ClaimTypeLabel } from "./schema.js";
import { ClaimTypeEnum } from "./schema.js";
import type { InvocationResult } from "./invoke-classifier.js";

export interface ScoreReport {
  totalFixtures: number;
  overallAccuracy: number;
  perClaimTypeAccuracy: Record<
    ClaimTypeLabel,
    { correct: number; total: number; accuracy: number }
  >;
  meanLatencyMs: number;
}

export function scoreResults(results: InvocationResult[]): ScoreReport {
  const perType: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const type of ClaimTypeEnum.options) {
    perType[type] = { correct: 0, total: 0, accuracy: 0 };
  }
  let totalLatency = 0;
  let totalMatched = 0;
  for (const r of results) {
    perType[r.expected].total += 1;
    if (r.matched) {
      perType[r.expected].correct += 1;
      totalMatched += 1;
    }
    totalLatency += r.latencyMs;
  }
  for (const type of ClaimTypeEnum.options) {
    const t = perType[type];
    t.accuracy = t.total === 0 ? 0 : t.correct / t.total;
  }
  return {
    totalFixtures: results.length,
    overallAccuracy: results.length === 0 ? 0 : totalMatched / results.length,
    perClaimTypeAccuracy: perType as ScoreReport["perClaimTypeAccuracy"],
    meanLatencyMs: results.length === 0 ? 0 : totalLatency / results.length,
  };
}

export interface ComparisonResult {
  passed: boolean;
  regressions: string[];
}

// Intentionally config-independent (not read from baseline.toleranceBps, which gates
// per-class drops at 2pp): the overall gate is deliberately stricter at 1pp, and inlining
// it avoids a Baseline schema change that would force re-locking baseline.json.
const OVERALL_TOLERANCE_BPS = 100; // 1.00pp

const PER_CLASS_MIN_ADDITIONAL_WRONG = 2;
const OVERALL_MIN_ADDITIONAL_WRONG = 3;

// Sum of (total - correct) across all claim types, from raw integer counts — so the
// overall regression rule never depends on Math.round(accuracy * total). Tolerates a
// partial record (a baseline category with no entry) by skipping undefined metrics.
export function countWrong(
  perClass: Record<string, { correct: number; total: number } | undefined>,
): number {
  let wrong = 0;
  for (const type of ClaimTypeEnum.options) {
    const m = perClass[type];
    if (!m) continue;
    wrong += m.total - m.correct;
  }
  return wrong;
}

export function compareAgainstBaseline(report: ScoreReport, baseline: Baseline): ComparisonResult {
  const regressions: string[] = [];
  const toleranceFraction = baseline.toleranceBps / 10_000;
  for (const type of ClaimTypeEnum.options) {
    const current = report.perClaimTypeAccuracy[type];
    if (current.total === 0) continue;
    const baselineMetric = baseline.perClaimTypeAccuracy[type];
    if (!baselineMetric || baselineMetric.total === 0) continue;
    const drop = baselineMetric.accuracy - current.accuracy;
    // Clamp at 0 so the name matches the semantics: an improved class has no "additional wrong".
    const additionalWrong = Math.max(
      0,
      current.total - current.correct - (baselineMetric.total - baselineMetric.correct),
    );
    // Effective blocking threshold is additionalWrong >= PER_CLASS_MIN_ADDITIONAL_WRONG.
    // The pp drop alone never blocks: at small fixture counts one stochastic flip is a
    // large pp swing but is not statistically meaningful.
    if (drop > toleranceFraction && additionalWrong >= PER_CLASS_MIN_ADDITIONAL_WRONG) {
      regressions.push(
        `${type}: ${(current.accuracy * 100).toFixed(1)}% (current) vs ${(baselineMetric.accuracy * 100).toFixed(1)}% (baseline), drop ${(drop * 100).toFixed(1)}pp > ${(toleranceFraction * 100).toFixed(1)}pp tolerance AND +${additionalWrong} wrong fixtures (>= ${PER_CLASS_MIN_ADDITIONAL_WRONG})`,
      );
    }
  }
  // Integer bps comparison avoids float drift around exact 1pp boundaries.
  const overallDropBps = Math.round((baseline.overallAccuracy - report.overallAccuracy) * 10_000);
  const overallAdditionalWrong = Math.max(
    0,
    countWrong(report.perClaimTypeAccuracy) - countWrong(baseline.perClaimTypeAccuracy),
  );
  // Effective blocking threshold is overallAdditionalWrong >= OVERALL_MIN_ADDITIONAL_WRONG.
  // The 1pp drop is only an early signal; it never blocks on its own.
  if (
    overallDropBps > OVERALL_TOLERANCE_BPS &&
    overallAdditionalWrong >= OVERALL_MIN_ADDITIONAL_WRONG
  ) {
    const overallDropPp = overallDropBps / 100;
    regressions.push(
      `overall: ${(report.overallAccuracy * 100).toFixed(1)}% (current) vs ${(baseline.overallAccuracy * 100).toFixed(1)}% (baseline), drop ${overallDropPp.toFixed(2)}pp > ${(OVERALL_TOLERANCE_BPS / 100).toFixed(2)}pp tolerance AND +${overallAdditionalWrong} wrong fixtures (>= ${OVERALL_MIN_ADDITIONAL_WRONG})`,
    );
  }
  return { passed: regressions.length === 0, regressions };
}
