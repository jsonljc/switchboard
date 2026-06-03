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
 * `deployment` is REQUIRED. The top-level resolver (resolveAuthoritativeDeployment)
 * uses `targetHint.skillSlug` and, unlike the child-work resolver, does NOT fall
 * back to "api-direct". With no targetHint it would derive the slug from the intent
 * prefix ("adoptimizer"), which does not match Riley's seeded "ad-optimizer"
 * deployment, so the submit would fail `deployment_not_found` BEFORE governance.
 * Riley's cron resolves its own per-org deployment and passes it here.
 */
export function buildRecommendationHandoffSubmitRequest(
  input: RecommendationHandoffSubmitInput,
  deployment: { deploymentId: string; skillSlug: string },
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
    targetHint: { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug },
  };
}
