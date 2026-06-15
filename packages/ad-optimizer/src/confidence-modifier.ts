// packages/ad-optimizer/src/confidence-modifier.ts
//
// Riley's FIRST learning wire (D7-2). Operator approve/reject verdicts are already
// stored (recommendation-store.ts applyAct writes `acted`/`dismissed`) but were
// discarded as a learning substrate: rec confidence was hardcoded per-cause
// constants. This turns the per-org, per-action-kind approval history into a
// bounded, abstaining confidence modifier applied once per rec in the engine.
//
// SAFETY (the audit's reason for existing — feedback_nan_blind_comparison_gates):
// the modifier ABSTAINS (returns the neutral 1.0) below a min-sample floor and on
// any non-finite count, is BOUNDED to [floor, ceiling] so a single bad streak can
// never collapse or inflate confidence, and is Number.isFinite-guarded BEFORE every
// comparison. It never fabricates a signal it does not have.

/** Minimum verdicts (approved + rejected) for an action kind before history may move
 * confidence at all. Below this, the modifier abstains (1.0). Echoes the repo's
 * MIN_SOURCE_BOOKINGS = 3 discipline (and exceeds it): a couple of verdicts is not a
 * signal. */
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";

export const MIN_VERDICTS_FOR_MODIFIER = 8;

/** Bounded band. A learned prior may scale a base confidence by at most ±15%; one
 * bad (or good) streak can never drive confidence to absurdity. */
const MODIFIER_CEILING = 1.15;
const MODIFIER_FLOOR = 0.85;
/** Neutral pivot: a 50% approval rate moves nothing. */
const PIVOT_RATE = 0.5;
/** How hard the rate deviation pulls the modifier (gentle by design). */
const SENSITIVITY = 0.3;

export interface KindVerdictCounts {
  /** Operator-accepted verdicts for this action kind (DB status `acted`). */
  approved: number;
  /** Operator-rejected verdicts for this action kind (DB status `dismissed`). */
  rejected: number;
}

/**
 * A bounded, abstaining confidence modifier from an org's operator approve/reject
 * history for a single action kind. The verdicts `applyAct` already stores become a
 * gentle prior on the next cycle's confidence.
 *
 * ABSTAINS (returns 1.0) below MIN_VERDICTS_FOR_MODIFIER and on any non-finite count:
 * a sparse or malformed history must never fabricate a signal. BOUNDED to
 * [MODIFIER_FLOOR, MODIFIER_CEILING] so a single bad streak cannot collapse or inflate
 * confidence.
 */
export function confidenceModifierForKind(counts: KindVerdictCounts): number {
  const { approved, rejected } = counts;
  if (!Number.isFinite(approved) || !Number.isFinite(rejected)) return 1.0;
  const total = approved + rejected;
  if (total < MIN_VERDICTS_FOR_MODIFIER) return 1.0;
  const rate = approved / total;
  const raw = 1 + (rate - PIVOT_RATE) * SENSITIVITY * 2;
  return Math.min(MODIFIER_CEILING, Math.max(MODIFIER_FLOOR, raw));
}

/** Scale a base confidence by a modifier, clamped to [0,1]. Identity when modifier is
 * 1.0. Guards non-finite inputs: a non-finite modifier leaves the confidence unchanged
 * (never NaN-poisons it); a non-finite base confidence is returned as-is (the caller's
 * problem to surface, not this function's to silently zero). */
export function applyConfidenceModifier(confidence: number, modifier: number): number {
  if (!Number.isFinite(modifier)) return confidence;
  if (!Number.isFinite(confidence)) return confidence;
  return Math.min(1, Math.max(0, confidence * modifier));
}

/**
 * Apply a bounded, abstaining per-kind modifier to a batch of recommendations, returning a
 * NEW array with each confidence scaled (and clamped to [0,1]). An ABSENT modifier returns
 * the SAME array unchanged (back-compat, identical references). This is the SINGLE
 * application point for the learning wires: the engine calls it once after building its
 * recs, and PR 3.4's outcome readback composes through the same clamp here rather than
 * adding a second scaling path. Watches are not passed in (they carry no operator-confidence
 * semantics).
 */
export function applyConfidenceModifierToRecs(
  recs: RecommendationOutput[],
  modifierByKind: ((action: RecommendationOutput["action"]) => number) | undefined,
): RecommendationOutput[] {
  if (!modifierByKind) return recs;
  return recs.map((rec) => ({
    ...rec,
    confidence: applyConfidenceModifier(rec.confidence, modifierByKind(rec.action)),
  }));
}
