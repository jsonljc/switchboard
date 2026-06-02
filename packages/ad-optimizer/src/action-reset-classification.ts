import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";

/**
 * Canonical, single-source-of-truth classification of whether each Riley action
 * resets Meta's learning phase, per Meta mechanics (see the Phase-A spec §5).
 *
 *  - "yes": adding/removing creative, targeting/structure change, or optimization-
 *    event change — Meta re-enters learning.
 *  - "conditional": budget moves that reset ONLY past the ~20% significant-edit
 *    threshold. Riley's `scale` is capped at 20% so it is "no"; generic budget
 *    reviews/shifts can exceed it, so "conditional".
 *  - "no": pause (a <7d pause does not reset; Riley's pause is immediate, not a
 *    timed >=7d pause), hold, and pixel/CAPI hygiene.
 *
 * INVARIANT (enforced in recommendation-sink): any action classified "yes" is
 * never swipe-approvable, regardless of its financial classification.
 */
export const ACTION_RESETS_LEARNING: Record<AdRecommendationAction, ResetsLearning> = {
  scale: "no",
  pause: "no",
  refresh_creative: "yes",
  restructure: "yes",
  hold: "no",
  test: "no",
  review_budget: "conditional",
  add_creative: "yes",
  expand_targeting: "yes",
  consolidate: "yes",
  shift_budget_to_source: "conditional",
  switch_optimization_event: "yes",
  harden_capi_attribution: "no",
  fix_signal_health: "no",
};

export function resetsLearningFor(action: AdRecommendationAction): ResetsLearning {
  return ACTION_RESETS_LEARNING[action];
}

/**
 * Human-facing impact string derived from the structured class (replaces the old
 * hand-authored `learningPhaseImpact` strings).
 */
export function learningPhaseImpactText(action: AdRecommendationAction): string {
  switch (resetsLearningFor(action)) {
    case "yes":
      return "will reset learning";
    case "conditional":
      return "may reset learning if the budget change exceeds ~20%";
    case "no":
      return "no impact";
  }
}
