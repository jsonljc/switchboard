import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import type { AdRecommendationActionSchema as AdRecommendationAction } from "@switchboard/schemas";
import { shouldAbstainFromHandoff } from "@switchboard/ad-optimizer";

export interface RecommendationHandoffSubmitInput {
  organizationId: string;
  recommendationId: string;
  actionType: AdRecommendationAction;
  campaignId: string;
  rationale: string;
  evidence: { clicks: number; conversions: number; days: number };
  learningPhaseActive: boolean;
  brief: { productDescription: string; targetAudience: string };
}

/**
 * Build the canonical submit request for a Riley -> agent recommendation handoff.
 * Returns NULL when Riley should abstain (below the evidence floor, learning-
 * locked, or an unroutable non-creative action) - the caller MUST then not submit
 * (abstention is the initiator's first-line responsibility; the handler re-checks
 * as defense in depth).
 *
 * Cron-initiated work is a TRACE ROOT, so it carries the seeded `system` principal
 * VERBATIM ({ id: "system", type: "system" } -> the "default" IdentitySpec). A
 * bespoke `system:<x>` id has no IdentitySpec and hard-denies with empty outputs.
 *
 * NOTE on `deployment`: the handoff intent's governance matches on `actionType`
 * (the intent string), NOT on a skillSlug, so this intent does NOT need a Riley
 * deployment to be gated correctly. When `deployment` is null the intent's own
 * deployment resolves to the "api-direct" fallback (the resolver derives slug from
 * the intent prefix "adoptimizer", which intentionally does not match Riley's
 * seeded "ad-optimizer" slug). That is harmless here. The child draft
 * (creative.concept.draft) resolves the "creative" deployment on its own. Pass a
 * resolved Riley deployment only as a provenance/targeting hint.
 */
export function buildRecommendationHandoffSubmitRequest(
  input: RecommendationHandoffSubmitInput,
  deployment: { deploymentId: string; skillSlug: string } | null,
): CanonicalSubmitRequest | null {
  const abstention = shouldAbstainFromHandoff({
    actionType: input.actionType,
    evidence: input.evidence,
    learningPhaseActive: input.learningPhaseActive,
  });
  if (abstention.abstain) {
    return null;
  }

  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.recommendation.handoff",
    parameters: {
      recommendationId: input.recommendationId,
      actionType: input.actionType,
      campaignId: input.campaignId,
      rationale: input.rationale,
      evidence: input.evidence,
      learningPhaseActive: input.learningPhaseActive,
      brief: {
        productDescription: input.brief.productDescription,
        targetAudience: input.brief.targetAudience,
      },
    },
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: `handoff:riley:${input.recommendationId}:${input.actionType}`,
    targetHint: deployment
      ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
      : undefined,
  };
}
