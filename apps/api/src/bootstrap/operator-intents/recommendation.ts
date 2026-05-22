// apps/api/src/bootstrap/operator-intents/recommendation.ts
// ---------------------------------------------------------------------------
// Phase 1b.2 / Route Governance Contract v1 PR-1 — operator.act_on_recommendation
//
// Cohort B → A migration (spec §5.1): the row-existence + tenant-isolation
// check now lives in the handler instead of a route pre-flight, so
// cross-tenant attempts produce a persisted WorkTrace with
// `failed-RECOMMENDATION_NOT_FOUND`. The route no longer pre-fetches.
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

      // Tenant-isolation reject: fold the route's former pre-flight check into
      // the handler so the failure path persists a WorkTrace. Cross-tenant
      // attempts surface as RECOMMENDATION_NOT_FOUND (not TENANT_MISMATCH) per
      // spec §5.1 — the conflation is intentional (do not leak existence).
      const row = await recommendationStore.getById(params.recommendationId);
      if (!row || row.orgId !== workUnit.organizationId) {
        return {
          outcome: "failed" as const,
          summary: "Recommendation not found",
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_NOT_FOUND,
            message: "Recommendation not found",
          },
        };
      }

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
        // Genuine unexpected — rethrow so the global handler returns scrubbed 500.
        throw err;
      }
    },
  };
}
