import { transitionOpportunityStage, OpportunityNotFoundError } from "@switchboard/core/lifecycle";
import type { OpportunityStore } from "@switchboard/core";
import {
  OperatorMutationMode,
  type ExecutionModeRegistry,
  type IntentRegistry,
  type OperatorMutationHandler,
} from "@switchboard/core/platform";
import { TransitionOpportunityStageParametersSchema } from "../routes/operator-intents-schemas.js";

/**
 * Wires operator-direct intents (Wave 2 Phase 1b migrations) into the
 * `IntentRegistry` and registers `OperatorMutationMode` in the
 * `ExecutionModeRegistry`.
 *
 * Self-contained: does not share the `WorkflowMode` handlers Map with
 * `bootstrap/contained-workflows.ts`. Each mode owns its own handler set.
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * Amendment 2.
 */

interface OperatorIntentsBootstrapDeps {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  opportunityStore: OpportunityStore;
  logger?: { info(msg: string): void };
}

export const TRANSITION_OPPORTUNITY_STAGE_INTENT = "operator.transition_opportunity_stage";

/**
 * Error codes returned by operator-mutation handlers. Routes and handlers
 * share these literals so a rename on one side is a compile error on the
 * other. Future Phase 1b/1c intents extend this object.
 */
export const OPERATOR_INTENT_ERROR_CODES = {
  OPPORTUNITY_NOT_FOUND: "OPPORTUNITY_NOT_FOUND",
} as const;

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

export function bootstrapOperatorIntents(deps: OperatorIntentsBootstrapDeps): void {
  const { intentRegistry, modeRegistry, opportunityStore, logger } = deps;

  const handlers = new Map<string, OperatorMutationHandler>([
    [TRANSITION_OPPORTUNITY_STAGE_INTENT, buildTransitionOpportunityStageHandler(opportunityStore)],
  ]);

  modeRegistry.register(new OperatorMutationMode({ handlers }));

  intentRegistry.register({
    intent: TRANSITION_OPPORTUNITY_STAGE_INTENT,
    defaultMode: "operator_mutation",
    allowedModes: ["operator_mutation"],
    executor: { mode: "operator_mutation" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: true,
    allowedTriggers: ["api"],
    timeoutMs: 30_000,
    retryable: false,
  });

  logger?.info("Operator mutation mode registered with 1 operator intent");
}
