import type { AttributableKind } from "./outcome-attribution-config.js";
import type {
  BusinessContextStability,
  OrgBookedWindowStats,
} from "./outcome-attribution-types.js";

/**
 * The corroboration predicate for the outcome ledger (Riley v3 slice 4d;
 * spec docs/superpowers/specs/2026-06-06-riley-v3-slice4d-corroborated-
 * outcomes-design.md section 2; v3 spec 2.5 and risk 7.5).
 *
 * "Corroborated" means an INDEPENDENT second estimate agrees with the
 * Meta-side delta, read from the booked-value/CRM side: the org's booked
 * revenue per ad dollar held (or improved) across the same two half-open
 * windows while this campaign's spend fell. The campaign-level form of this
 * signal is mathematically degenerate for pause (post-pause campaign spend
 * tends to zero), so the comparison is org-level on BOTH sides: account
 * spend from the Meta window read, org-wide booked value from the
 * conversion ledger. It is independent outcome-side agreement under floors,
 * NOT causal proof.
 *
 * The predicate only ever UPGRADES a row that is already directional; every
 * failure mode below leaves today's value untouched. It never demotes, and
 * its absence is never an error: unjudgeable means "stay honest, say
 * directional".
 */

/**
 * Minimum valued bookings (type:"booked", value > 0) in EACH window for the
 * booking-side estimate to be judgeable. Echoes the repo's
 * MIN_SOURCE_BOOKINGS = 3. A 0-booking window is unjudgeable by definition
 * (the spec's "never fabricate corroborated from a 0-booking window" made
 * literal, with margin): one lucky booking must not certify agreement.
 */
export const CORROBORATION_MIN_BOOKINGS_PER_WINDOW = 3;

/**
 * The anti-degeneracy floor: post-window account spend must be at least this
 * fraction of pre-window account spend for "bookings per ad dollar" to be
 * the same statistic across the two windows. A single-campaign org's account
 * spend collapses with the pause (the 4c Decision-F degeneracy) and fails
 * here; so does pausing a campaign that dominated account spend, where the
 * residual traffic is a different regime. Bounding denominator shrinkage at
 * 2x also bounds the ratio comparison's noise amplification.
 */
export const CORROBORATION_SPEND_CONTINUITY_FLOOR = 0.5;

/**
 * The anti-mix-shift ceiling, the floor's mirror: a major post-anchor
 * scale-up (another campaign launched or scaled hard) changes the
 * statistic's regime just as surely as a collapse, and a ratio that "held"
 * across a doubled account is agreement about a different account. v1
 * limitation, recorded: the band checks the account-level denominator only;
 * campaign-mix shift WITHIN the band, organic-demand spikes, cross-channel
 * campaigns, and in-window seasonality are not detected here (the
 * operator-confirmed unstable block catches the operator-visible subset).
 */
export const CORROBORATION_SPEND_CONTINUITY_CEILING = 1.5;

/**
 * "Held" tolerance: the post-window booked-revenue-per-dollar ratio must be
 * at least this fraction of the pre-window ratio. Wider than the
 * single-metric noise floors (5%/10%) because this is a ratio of ratios over
 * two sparse windows; window-to-window booking variance at SMB volume
 * comfortably exceeds single-metric variance. A >20% efficiency degradation
 * cannot honestly be called "held".
 */
export const CORROBORATION_RATIO_HOLD_TOLERANCE = 0.8;

/**
 * Why corroboration did or did not hold. "corroborated" is the only reason
 * that upgrades; every other value names the first gate that rejected, in
 * evaluation order. Exists so tests pin exact failure modes and rollout
 * debugging never reconstructs why corroborated stayed off.
 */
export type CorroborationReason =
  | "corroborated"
  | "not_pause"
  | "visibility_flagged"
  | "missing_delta"
  | "unfavorable_direction"
  | "unstable_context"
  | "missing_booking_stats"
  | "missing_account_spend"
  | "non_finite_input"
  | "sparse_bookings"
  | "spend_continuity_failed"
  | "invalid_booked_value"
  | "ratio_degraded";

export interface CorroborationVerdict {
  /** "corroborated" when the second estimate agrees under floors; null otherwise. */
  causalStrengthUpgrade: "corroborated" | null;
  reason: CorroborationReason;
}

export interface DeriveCorroborationInput {
  actionKind: AttributableKind;
  /** Number of visibility flags on the row (any flag means no clean first estimate). */
  visibilityFlagCount: number;
  /** The campaign-level delta; null when not computable. */
  deltaPct: number | null;
  businessContextStable: BusinessContextStability;
  /** Org-level Meta spend for the pre window, cents; undefined when the provider cannot supply it. */
  preAccountSpendCents: number | undefined;
  /** Org-level Meta spend for the post window, cents; undefined when the provider cannot supply it. */
  postAccountSpendCents: number | undefined;
  /** Org-level booked stats for both windows; undefined when no reader is wired. */
  orgBookedStats: { preWindow: OrgBookedWindowStats; postWindow: OrgBookedWindowStats } | undefined;
}

function reject(reason: Exclude<CorroborationReason, "corroborated">): CorroborationVerdict {
  return { causalStrengthUpgrade: null, reason };
}

/**
 * The reasoned corroboration verdict. Self-contained honesty: every
 * precondition and floor is re-checked here (defense in depth, mirroring
 * operational-stability.ts), so no caller can reach the agreement test with
 * a flagged row or a missing input. Callers that persist consume only
 * causalStrengthUpgrade; the reason is for tests and rollout debugging.
 */
export function deriveCorroboration(input: DeriveCorroborationInput): CorroborationVerdict {
  // P1: pause-only. refresh_creative is a recorded deferral (spec 4d
  // section 6): per-campaign booking sparsity, lag contamination without a
  // differencing majority, and weak agreement semantics.
  if (input.actionKind !== "pause") return reject("not_pause");
  // P2: the first estimate must exist and be clean (the row would be
  // directional today).
  if (input.visibilityFlagCount > 0) return reject("visibility_flagged");
  if (input.deltaPct === null) return reject("missing_delta");
  // P3: favorable only (pause's favorableDirection is "down"). An
  // unfavorable pause failed on its own metric; there is no effect for the
  // booking side to corroborate.
  if (input.deltaPct >= 0) return reject("unfavorable_direction");
  // P4: affirmative operator-confirmed disruption confounds the booking-side
  // estimate exactly as it confounds the Meta-side delta. "unknown" does NOT
  // block: the booking signal's independence does not depend on operator
  // attestation.
  if (input.businessContextStable === "unstable") return reject("unstable_context");
  // F1: both inputs must exist; absence is unjudgeable, never an error.
  if (input.orgBookedStats === undefined) return reject("missing_booking_stats");
  if (input.preAccountSpendCents === undefined || input.postAccountSpendCents === undefined) {
    return reject("missing_account_spend");
  }
  const { preWindow, postWindow } = input.orgBookedStats;
  // Finite guard, BEFORE any comparison gate: every reject below is a
  // numeric comparison, and every comparison with NaN is false, so without
  // this guard a single malformed upstream value (Meta returns spend as
  // strings; parseFloat of a non-numeric sentinel is NaN) would sail past
  // every floor to a fabricated "corroborated". Review-caught; the one
  // degenerate value the floors cannot catch by comparison.
  if (
    ![
      input.deltaPct,
      input.preAccountSpendCents,
      input.postAccountSpendCents,
      preWindow.bookedValueCents,
      preWindow.bookedCount,
      postWindow.bookedValueCents,
      postWindow.bookedCount,
    ].every(Number.isFinite)
  ) {
    return reject("non_finite_input");
  }
  // F2: sparse-booking floor, each window independently.
  if (
    preWindow.bookedCount < CORROBORATION_MIN_BOOKINGS_PER_WINDOW ||
    postWindow.bookedCount < CORROBORATION_MIN_BOOKINGS_PER_WINDOW
  ) {
    return reject("sparse_bookings");
  }
  // F3: spend continuity, both directions (the comparable-regime band).
  if (input.preAccountSpendCents <= 0) return reject("spend_continuity_failed");
  if (
    input.postAccountSpendCents <
      CORROBORATION_SPEND_CONTINUITY_FLOOR * input.preAccountSpendCents ||
    input.postAccountSpendCents >
      CORROBORATION_SPEND_CONTINUITY_CEILING * input.preAccountSpendCents
  ) {
    return reject("spend_continuity_failed");
  }
  // Explicit ratio guards (defensive: the live reader's value > 0 predicate
  // makes these unreachable via F2, but the invariant preRatio > 0 must not
  // depend on a store predicate surviving future schema changes).
  if (preWindow.bookedValueCents <= 0 || postWindow.bookedValueCents < 0) {
    return reject("invalid_booked_value");
  }
  // A1: the agreement test. Cents over cents on both sides; dimensionless.
  const preRatio = preWindow.bookedValueCents / input.preAccountSpendCents;
  const postRatio = postWindow.bookedValueCents / input.postAccountSpendCents;
  if (postRatio < CORROBORATION_RATIO_HOLD_TOLERANCE * preRatio) {
    return reject("ratio_degraded");
  }
  return { causalStrengthUpgrade: "corroborated", reason: "corroborated" };
}
