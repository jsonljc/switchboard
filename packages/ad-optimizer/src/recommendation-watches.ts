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
