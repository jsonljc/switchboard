import { z } from "zod";
import { RecommendationHandoffEvidence } from "./recommendation-handoff.js";

/**
 * PHASE-C wiring: the parameters contract for `adoptimizer.campaign.pause`
 * (Riley self-executing a pause through the governed path). Mirrors the
 * RecommendationHandoffInput projection shape, with actionType pinned to the
 * literal "pause": the seam is pause-only by design (widening requires a new
 * PHASE_C_EXECUTION_SEAM entry + class review, not a parameter change).
 */

/** Pause execution owns its own evidence name. Today it aliases the handoff
 * evidence shape (which mirrors ad-optimizer's `Evidence`); the named seam
 * exists so the two can diverge without a consumer migration. */
export const RileyPauseEvidence = RecommendationHandoffEvidence;
export type RileyPauseEvidence = z.infer<typeof RileyPauseEvidence>;

export const RileyPauseExecutionInput = z.object({
  recommendationId: z.string().min(1),
  actionType: z.literal("pause"),
  campaignId: z.string().min(1),
  rationale: z.string().min(1),
  evidence: RileyPauseEvidence,
});
export type RileyPauseExecutionInput = z.infer<typeof RileyPauseExecutionInput>;
