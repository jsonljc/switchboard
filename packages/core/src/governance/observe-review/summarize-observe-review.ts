import {
  GOVERNANCE_GATE_UNITS,
  sourceGuardToGateUnit,
  type GovernanceGateUnit,
  type GovernanceVerdictAction,
  type GovernanceVerdictReason,
  type GovernanceVerdictSource,
} from "@switchboard/schemas";
import { deriveEnforceAction } from "./derive-enforce-action.js";

/** One grouped aggregation row from the verdict store. */
export interface VerdictSummaryRow {
  sourceGuard: string;
  reasonCode: string;
  action: string;
  count: number;
}

export interface UnitReview {
  wouldBlock: number;
  wouldRewrite: number;
  wouldEscalate: number;
  wouldTemplate: number;
  total: number;
}

export type ObserveReviewByUnit = Record<GovernanceGateUnit, UnitReview>;

function emptyUnit(): UnitReview {
  return { wouldBlock: 0, wouldRewrite: 0, wouldEscalate: 0, wouldTemplate: 0, total: 0 };
}

/**
 * Rolls grouped verdict-summary rows into per-unit "what enforce would have done"
 * counts. Rows whose sourceGuard is not a flippable unit (e.g. escalation_trigger)
 * are excluded entirely. The would-act bucket is derived per row via
 * deriveEnforceAction, not read from the stored action (observe stores "allow").
 */
export function summarizeObserveReview(rows: VerdictSummaryRow[]): ObserveReviewByUnit {
  const out = Object.fromEntries(
    GOVERNANCE_GATE_UNITS.map((u) => [u, emptyUnit()]),
  ) as ObserveReviewByUnit;

  for (const row of rows) {
    const unit = sourceGuardToGateUnit(row.sourceGuard as GovernanceVerdictSource);
    if (!unit) continue; // not a flippable unit (e.g. escalation_trigger)
    const review = out[unit];
    review.total += row.count;
    const action = deriveEnforceAction(
      row.sourceGuard as GovernanceVerdictSource,
      row.reasonCode as GovernanceVerdictReason,
      row.action as GovernanceVerdictAction,
    );
    if (action === "block") review.wouldBlock += row.count;
    else if (action === "rewrite") review.wouldRewrite += row.count;
    else if (action === "escalate") review.wouldEscalate += row.count;
    else if (action === "template") review.wouldTemplate += row.count;
  }
  return out;
}
