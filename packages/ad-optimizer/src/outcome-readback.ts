// packages/ad-optimizer/src/outcome-readback.ts
//
// D7-1 / D9-5: the IMPROVE-leg consumer of Riley's outcome ledger. The attribution engine writes
// RileyOutcomeRow with causalStrength + trustDelta, but until now the only reader was the cockpit
// feed, so last cycle's MEASURED outcomes never informed this cycle's confidence. This turns the
// per-kind aggregate of CORROBORATED outcomes into a bounded, abstaining confidence multiplier,
// composed with PR 3.2's approval modifier through the SAME applyConfidenceModifier clamp.
//
// This IS the Phase-C switch the TrustDelta contract named. It honors the bar fully: ONLY
// CORROBORATED rows (a second, independent booked-value estimate agreed) may move trust. Directional
// (non-corroborated) rows are excluded ENTIRELY from both the count and the direction, so weak
// evidence can never sway or override the signal (not merely the directional-only case). The nudge
// is bounded TIGHTER than the approval modifier (outcomes are scarcer + noisier), Number.isFinite-
// guarded before any comparison, and NEVER treats corroborated as causal proof (the row's invariant).

/** Minimum DIRECTIONED CORROBORATED outcomes for an action kind before history may move confidence.
 * Below this the readback abstains. Echoes the corroboration MIN_SOURCE_BOOKINGS >= 3 discipline: a
 * couple of corroborated outcomes is not yet a signal. */
export const MIN_OUTCOMES_FOR_READBACK = 3;

/** Tighter band than the approval-rate modifier's [0.85, 1.15]: outcomes are scarcer and noisier, so
 * they earn less leverage on confidence. */
const MULTIPLIER_CEILING = 1.1;
const MULTIPLIER_FLOOR = 0.9;
const PIVOT_RATE = 0.5;
const SENSITIVITY = 0.2;

export interface OutcomeCountsByKind {
  /** Count of CORROBORATED outcome rows with trustDelta "up" for this action kind. Directional rows
   * are deliberately NOT counted: only corroborated evidence may move trust. */
  corroboratedUp: number;
  /** Count of CORROBORATED outcome rows with trustDelta "down". */
  corroboratedDown: number;
}

export interface OutcomeAdjustment {
  /** Bounded multiplier in [MULTIPLIER_FLOOR, MULTIPLIER_CEILING]; exactly 1.0 when abstaining. */
  confidenceMultiplier: number;
  /** True when the readback declined to move confidence (sparse or non-finite corroborated direction). */
  abstained: boolean;
}

/**
 * Bounded, abstaining outcome -> confidence adjustment for a single action kind, computed from
 * CORROBORATED rows ONLY. ABSTAINS (neutral 1.0) on any non-finite count and when fewer than
 * MIN_OUTCOMES_FOR_READBACK corroborated rows carry a trust direction (so a sparse history AND a
 * directional-only history both abstain, since directional rows are never counted upstream).
 * Otherwise leans toward the corroborated favorable share, bounded to the band.
 */
export function outcomeAdjustmentForKind(counts: OutcomeCountsByKind): OutcomeAdjustment {
  const { corroboratedUp, corroboratedDown } = counts;
  if (!Number.isFinite(corroboratedUp) || !Number.isFinite(corroboratedDown)) {
    return { confidenceMultiplier: 1.0, abstained: true };
  }
  const directioned = corroboratedUp + corroboratedDown;
  if (directioned < MIN_OUTCOMES_FOR_READBACK) {
    return { confidenceMultiplier: 1.0, abstained: true };
  }
  const favorableRate = corroboratedUp / directioned;
  const raw = 1 + (favorableRate - PIVOT_RATE) * SENSITIVITY;
  const confidenceMultiplier = Math.min(MULTIPLIER_CEILING, Math.max(MULTIPLIER_FLOOR, raw));
  return { confidenceMultiplier, abstained: false };
}
