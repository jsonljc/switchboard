import { z } from "zod";
import { OpportunityStageSchema } from "@switchboard/schemas";

/**
 * Zod schemas for operator-direct intent parameters (Wave 2 Phase 1b).
 *
 * Co-located with API routes for Phase 1b. Will migrate to
 * `@switchboard/schemas` when Design A canonicalizes the operator-direct
 * intent catalog.
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * "Reference implementation pattern" → "Artifact 1 — Intent registration".
 */

export const TransitionOpportunityStageParametersSchema = z.object({
  id: z.string().min(1),
  stage: OpportunityStageSchema,
});

export type TransitionOpportunityStageParameters = z.infer<
  typeof TransitionOpportunityStageParametersSchema
>;

export const ActOnRecommendationParametersSchema = z.object({
  recommendationId: z.string().min(1),
  action: z.enum(["primary", "secondary", "dismiss", "confirm", "undo"]),
  note: z.string().optional(),
});

export type ActOnRecommendationParameters = z.infer<typeof ActOnRecommendationParametersSchema>;
