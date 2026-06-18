// packages/ad-optimizer/src/recommendation-watches.ts
//
// Pure `WatchOutput` constructors used by the recommendation engine. These build a watch from a
// campaign identity and fixed pattern and contain NO firing logic — the engine
// (recommendation-engine.ts) owns the decision of whether/when to emit each. Kept in a sibling
// module so the engine stays under the 600-line architecture limit; each constructor is a leaf with
// no dependency on the engine's policy constants, so this module imports only from @switchboard/schemas.
import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

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
