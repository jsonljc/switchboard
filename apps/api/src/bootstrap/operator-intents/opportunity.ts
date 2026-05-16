// apps/api/src/bootstrap/operator-intents/opportunity.ts
// ---------------------------------------------------------------------------
// Phase 1b.1 — operator.transition_opportunity_stage handler factory
// ---------------------------------------------------------------------------
import { transitionOpportunityStage, OpportunityNotFoundError } from "@switchboard/core/lifecycle";
import type { OpportunityStore } from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { TransitionOpportunityStageParametersSchema } from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

export function buildTransitionOpportunityStageHandler(
  opportunityStore: OpportunityStore,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = TransitionOpportunityStageParametersSchema.parse(workUnit.parameters);
      try {
        const result = await transitionOpportunityStage(
          {
            orgId: workUnit.organizationId,
            id: params.id,
            stage: params.stage,
            actor: { id: workUnit.actor.id, type: "user" },
          },
          { opportunityStore },
        );
        return {
          outcome: "completed" as const,
          summary: `Opportunity ${params.id} transitioned to ${params.stage}`,
          outputs: { opportunity: result.opportunity },
        };
      } catch (err) {
        if (err instanceof OpportunityNotFoundError) {
          return {
            outcome: "failed" as const,
            summary: "Opportunity not found",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND,
              message: err.message,
            },
          };
        }
        throw err;
      }
    },
  };
}
