// ---------------------------------------------------------------------------
// Outcome Calibrator — Historical calibration for impact estimates
// ---------------------------------------------------------------------------
// Tracks outcome success rate per constraint type and uses it to inform
// future impact confidence adjustments.
// ---------------------------------------------------------------------------

import type { Intervention, ConstraintType } from "@switchboard/schemas";

export interface CalibrationEntry {
  successRate: number;
  avgImprovement: number;
  totalCount: number;
}

export function calibrateFromHistory(
  interventions: Intervention[],
): Map<ConstraintType, CalibrationEntry> {
  const groups = new Map<ConstraintType, { improved: number; total: number; totalDelta: number }>();

  for (const intervention of interventions) {
    // Only consider interventions with a resolved outcome
    if (
      intervention.outcomeStatus === "PENDING" ||
      intervention.outcomeStatus === "MEASURING" ||
      intervention.outcomeStatus === "INCONCLUSIVE"
    ) {
      continue;
    }

    const ct = intervention.constraintType;
    const existing = groups.get(ct) ?? { improved: 0, total: 0, totalDelta: 0 };
    existing.total++;

    if (intervention.outcomeStatus === "IMPROVED") {
      existing.improved++;
      // Estimate improvement from priority (lower priority = bigger constraint gap)
      existing.totalDelta += intervention.priority * 5;
    }

    groups.set(ct, existing);
  }

  const result = new Map<ConstraintType, CalibrationEntry>();
  for (const [ct, data] of groups) {
    result.set(ct, {
      successRate: data.total > 0 ? data.improved / data.total : 0,
      avgImprovement: data.improved > 0 ? data.totalDelta / data.improved : 0,
      totalCount: data.total,
    });
  }

  return result;
}
