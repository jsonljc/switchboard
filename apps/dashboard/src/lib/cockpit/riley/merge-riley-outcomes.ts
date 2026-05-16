// apps/dashboard/src/lib/cockpit/riley/merge-riley-outcomes.ts
//
// Pure helper: concatenate activity rows and outcome rows, then sort descending
// by timestampIso. Rows without timestampIso sort to the end in original order
// (stable-sort semantics preserved for equal timestamps).

import type { ActivityRow } from "@switchboard/schemas";

/**
 * Merge an activity feed with outcome rows and sort newest-first.
 *
 * Rows that carry a `timestampIso` are sorted descending. Rows without one
 * (legacy activity that only has a human `time` string) are kept at the end
 * in the order they originally appeared, because they cannot be reliably
 * ordered against timestamped rows.
 *
 * When two rows have the same `timestampIso` the activity rows appear before
 * outcome rows (stable — activity list is first in the concatenation). Callers
 * must NOT swap argument order: `mergeRileyActivityAndOutcomes(outcomes, activity)`
 * would invert the tie-breaking contract.
 */
export function mergeRileyActivityAndOutcomes(
  activity: ActivityRow[],
  outcomes: ActivityRow[],
): ActivityRow[] {
  const combined = [...activity, ...outcomes];
  // JS Array.prototype.sort is guaranteed stable in ES2019+ (V8 ≥ 7.0,
  // which covers Node 12+ and all modern browsers). Rows without timestampIso
  // receive -Infinity so they sort to the end; ties preserve insertion order.
  combined.sort((a, b) => {
    const ta = a.timestampIso ? new Date(a.timestampIso).getTime() : -Infinity;
    const tb = b.timestampIso ? new Date(b.timestampIso).getTime() : -Infinity;
    return tb - ta;
  });
  return combined;
}
