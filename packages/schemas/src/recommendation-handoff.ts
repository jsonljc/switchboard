import { z } from "zod";
import { AdRecommendationActionSchema } from "./ad-optimizer.js";

/**
 * Seam 3 (Riley -> agent) advisory->action handoff payload (Governed Handoff
 * Contract Freeze §4.3). A projection of ONE persisted Riley recommendation into
 * a governed brief, keyed by recommendationId. `actionType` reuses Riley's
 * centralized action enum - it is NOT a redefinition of the recommendation shape.
 * The frozen implemented scope is the creative -> Mira path (refresh_creative /
 * add_creative); any other action is UNROUTABLE at the workflow.
 *
 * `evidence` mirrors ad-optimizer's `Evidence` so the evidence-floor abstention
 * (meetsEvidenceFloor) reuses one shape across the seam.
 */
export const RecommendationHandoffEvidence = z.object({
  clicks: z.number(),
  conversions: z.number(),
  days: z.number(),
});
export type RecommendationHandoffEvidence = z.infer<typeof RecommendationHandoffEvidence>;

export const RecommendationHandoffInput = z.object({
  recommendationId: z.string().min(1),
  actionType: AdRecommendationActionSchema,
  campaignId: z.string().min(1),
  rationale: z.string().min(1),
  evidence: RecommendationHandoffEvidence,
});
export type RecommendationHandoffInput = z.infer<typeof RecommendationHandoffInput>;
