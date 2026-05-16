// apps/api/src/bootstrap/operator-intents/recommendation.ts
// ---------------------------------------------------------------------------
// Phase 1b.2 — operator.act_on_recommendation handler factory
// ---------------------------------------------------------------------------
import { actOnRecommendation } from "@switchboard/core";
import type { RecommendationStore } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { ActOnRecommendationParametersSchema } from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

export function buildActOnRecommendationHandler(
  recommendationStore: RecommendationStore,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = ActOnRecommendationParametersSchema.parse(workUnit.parameters);
      try {
        const result = await actOnRecommendation(recommendationStore, {
          recommendationId: params.recommendationId,
          orgId: workUnit.organizationId,
          actor: { principalId: workUnit.actor.id, type: "operator" },
          action: params.action,
          note: params.note,
        });
        return {
          outcome: "completed" as const,
          summary: `Recommendation ${params.recommendationId} acted on with ${params.action}`,
          outputs: { result },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("surface accepts")) {
          return {
            outcome: "failed" as const,
            summary: "Invalid action for recommendation surface",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_INVALID_ACTION,
              message: msg,
            },
          };
        }
        // "not found" and "org mismatch" are made unreachable by the pre-flight
        // checks in the route. If they surface here despite that, treat as
        // unexpected — rethrow so the global handler returns a scrubbed 500.
        throw err;
      }
    },
  };
}
