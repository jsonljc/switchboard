import type { AdRecommendationActionSchema as AdRecommendationAction } from "@switchboard/schemas";
import { meetsEvidenceFloor, type Evidence } from "./evidence-floor.js";
import { resetsLearningFor } from "./action-reset-classification.js";

/**
 * The ONLY Riley actions that route to a Mira creative draft (Governed Handoff
 * Contract Freeze §4.3 - the frozen implemented scope). Any other action is not
 * a creative handoff and is abstained as "unroutable_action".
 */
export const CREATIVE_HANDOFF_ACTIONS: ReadonlySet<AdRecommendationAction> = new Set([
  "refresh_creative",
  "add_creative",
]);

export type HandoffAbstentionReason =
  | "unroutable_action"
  | "below_evidence_floor"
  | "learning_locked";

export interface HandoffAbstentionDecision {
  abstain: boolean;
  reason?: HandoffAbstentionReason;
}

export interface HandoffAbstentionInput {
  actionType: AdRecommendationAction;
  evidence: Evidence;
  /** True when the campaign is in Meta's learning phase (a learning-reset would hurt). */
  learningPhaseActive: boolean;
}

/**
 * Decide whether Riley should abstain from handing a recommendation to Mira.
 * Pure + deterministic so the cron initiator (do not submit) and the workflow
 * handler (defense in depth) reach the same verdict from the same inputs.
 *
 * Order matters: routability first (cheapest; a non-creative action is never a
 * Mira handoff), then the evidence floor, then the learning-lockout. Abstention
 * is a deliberate no-op, NOT a failure.
 */
export function shouldAbstainFromHandoff(input: HandoffAbstentionInput): HandoffAbstentionDecision {
  if (!CREATIVE_HANDOFF_ACTIONS.has(input.actionType)) {
    return { abstain: true, reason: "unroutable_action" };
  }
  if (!meetsEvidenceFloor(input.actionType, input.evidence)) {
    return { abstain: true, reason: "below_evidence_floor" };
  }
  if (input.learningPhaseActive && resetsLearningFor(input.actionType) === "yes") {
    return { abstain: true, reason: "learning_locked" };
  }
  return { abstain: false };
}
