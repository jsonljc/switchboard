import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";
import { ACTION_CONTRACT } from "./action-contract.js";

/**
 * Learning-phase reset classification, now DERIVED from the consolidated
 * ACTION_CONTRACT (Riley v3 slice 2) -- see action-contract.ts for the rationale
 * per action (Meta mechanics, Phase-A spec section 5). Public API unchanged.
 *
 * INVARIANT (enforced in recommendation-sink): any action classified "yes" is
 * never swipe-approvable, regardless of its financial classification.
 */
export const ACTION_RESETS_LEARNING: Record<AdRecommendationAction, ResetsLearning> = (() => {
  const out = {} as Record<AdRecommendationAction, ResetsLearning>;
  for (const action of Object.keys(ACTION_CONTRACT) as AdRecommendationAction[]) {
    out[action] = ACTION_CONTRACT[action].resetsLearning;
  }
  return out;
})();

export function resetsLearningFor(action: AdRecommendationAction): ResetsLearning {
  return ACTION_CONTRACT[action].resetsLearning;
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
