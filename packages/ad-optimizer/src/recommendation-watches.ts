// packages/ad-optimizer/src/recommendation-watches.ts
//
// `WatchOutput` constructors (and one emit policy) for the recommendation engine. These build a watch
// from a campaign identity and fixed pattern; the audience-mismatch emit policy lives here too because
// it needs none of the engine's recommendation-threshold constants (unlike the burn / breach_building
// gates, which stay in recommendation-engine.ts). Kept in a sibling module so the engine stays under
// the 600-line architecture limit.
import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";
import type { Diagnosis } from "./metric-diagnostician.js";

/** The campaign identity every watch carries. Structural so these constructors stay decoupled from
 * the engine's full `RecommendationInput` (avoids a type import cycle); the engine's `base` object
 * already has this shape. */
type WatchBase = { campaignId: string; campaignName: string };

/**
 * Build an abstention watch for a recommendation whose action family lacks the
 * evidence to act (Phase-A spec Gate 2). Riley re-checks next cycle rather than
 * acting on noise. `checkBackDate` is left blank here — the caller
 * (campaign-decision.ts) fills it from `input.nextCycleDate` since the engine
 * has no access to that value.
 */
export function insufficientEvidenceWatch(
  base: WatchBase,
  action: RecommendationOutput["action"],
  e: { clicks: number; conversions: number },
): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "insufficient_evidence",
    message: `Not enough evidence to ${action}: ${e.clicks} clicks / ${e.conversions} conversions in window — re-checking next cycle.`,
    checkBackDate: "",
  };
}

/**
 * "Strong clicks but low conversions" advisory (D1-3). The `audience_offer_mismatch` diagnosis fires
 * (high confidence) on the deterministic audit seam — ctr holding/rising while acquisition cost rises
 * significantly — but no recommendation branch consumes it, so today it is computed and discarded.
 * This builds the informational watch that surfaces it. The firing DECISION (emit only when nothing
 * stronger already fired) lives in recommendation-engine.ts; this constructor is a pure leaf.
 * `checkBackDate` is left blank for the caller (campaign-decision.ts) to fill, like the other watches.
 */
export function audienceOfferMismatchWatch(base: WatchBase): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "audience_offer_mismatch",
    message:
      "Strong clicks but conversions are not keeping pace. The audience or offer may be mismatched; review the landing page, offer, and audience fit. Watching before any action.",
    checkBackDate: "",
  };
}

/**
 * Emit policy for the audience_offer_mismatch watch (D1-3). Surface it ONLY when the campaign would
 * otherwise be pure silence: `priorOutputs` empty means the engine produced no recommendation (or
 * evidence-floor watch), no zero-conversion burn, and no breach_building. Any of those is a stronger,
 * more specific signal for this campaign, so piling an advisory on top would be noise. The gate keys
 * off the boolean diagnosis presence + array-emptiness ALONE — no numeric comparison — so it carries
 * no NaN-blind-gate risk (#939); the cpa/ctr robustness stays in the diagnostician. Purely additive:
 * it changes no existing rec/watch/insight outcome.
 */
export function audienceOfferMismatchIfSilent(
  diagnoses: Diagnosis[],
  base: WatchBase,
  priorOutputs: (RecommendationOutput | WatchOutput)[],
): WatchOutput | null {
  if (priorOutputs.length > 0) return null;
  if (!diagnoses.some((d) => d.pattern === "audience_offer_mismatch")) return null;
  return audienceOfferMismatchWatch(base);
}

/**
 * A12 (count-vs-value gate): the paid-value floor for a `scale` -> reallocate money-move.
 * A `scale` rec may flow to the reallocation dispatch ONLY when the campaign has finite,
 * positive, campaign-attributed VERIFIED-PAID value. Fail-closed: null (no attributed paid
 * value), non-finite (NaN/Infinity from a poisoned sum), zero, or negative all return false,
 * so a cheap-cost-per-lead campaign whose leads never pay is held, never auto-scaled. Pure;
 * Number.isFinite-guarded before any comparison (every comparison with NaN is false, so a
 * comparison-only floor would silently pass NaN).
 */
export function scaleValueFloorMet(gate: { paidValueCents: number | null }): boolean {
  const v = gate.paidValueCents;
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Watch surfaced when a `scale` rec is demoted by the paid-value floor: the campaign's cost
 * per lead is under target, but no verified-paid revenue is attributed to it yet, so a budget
 * increase is not justified on lead count alone. Visible + recoverable (it graduates to a real
 * scale money-move once paid receipts populate). `checkBackDate` is filled by the caller
 * (campaign-decision.ts) from `input.nextCycleDate`, like the other watches.
 */
export function scaleUnprovenPaidValueWatch(base: WatchBase): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "scale_unproven_paid_value",
    message:
      "Holding a budget increase: cost per lead is under target, but no verified-paid revenue is attributed to this campaign yet, so scaling is not justified on lead count alone. Re-checking next cycle as paid receipts populate.",
    checkBackDate: "",
  };
}
