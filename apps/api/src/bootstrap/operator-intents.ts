import { transitionOpportunityStage, OpportunityNotFoundError } from "@switchboard/core/lifecycle";
import type {
  OpportunityStore,
  RecommendationStore,
  DisqualificationResolutionHook,
  HookConfirmResult,
  HookDismissResult,
} from "@switchboard/core";
import { actOnRecommendation } from "@switchboard/core";
import {
  OperatorMutationMode,
  type ExecutionModeRegistry,
  type IntentRegistry,
  type OperatorMutationHandler,
} from "@switchboard/core/platform";
import {
  TransitionOpportunityStageParametersSchema,
  ActOnRecommendationParametersSchema,
  ConfirmDisqualificationParametersSchema,
  DismissDisqualificationParametersSchema,
} from "../routes/operator-intents-schemas.js";

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
  recommendationStore?: RecommendationStore;
  disqualificationHook?: Pick<DisqualificationResolutionHook, "confirm" | "dismiss">;
  logger?: { info(msg: string): void };
}

export const TRANSITION_OPPORTUNITY_STAGE_INTENT = "operator.transition_opportunity_stage";
export const ACT_ON_RECOMMENDATION_INTENT = "operator.act_on_recommendation";
export const CONFIRM_DISQUALIFICATION_INTENT = "operator.confirm_disqualification";
export const DISMISS_DISQUALIFICATION_INTENT = "operator.dismiss_disqualification";

/**
 * Error codes returned by operator-mutation handlers. Routes and handlers
 * share these literals so a rename on one side is a compile error on the
 * other. Future Phase 1b/1c intents extend this object.
 */
export const OPERATOR_INTENT_ERROR_CODES = {
  OPPORTUNITY_NOT_FOUND: "OPPORTUNITY_NOT_FOUND",
  RECOMMENDATION_NOT_FOUND: "RECOMMENDATION_NOT_FOUND",
  RECOMMENDATION_INVALID_ACTION: "RECOMMENDATION_INVALID_ACTION",
  DISQUALIFICATION_NOT_FOUND: "DISQUALIFICATION_NOT_FOUND",
  DISQUALIFICATION_CONFLICT: "DISQUALIFICATION_CONFLICT",
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

export function buildConfirmDisqualificationHandler(
  hook: Pick<DisqualificationResolutionHook, "confirm">,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = ConfirmDisqualificationParametersSchema.parse(workUnit.parameters);
      const result: HookConfirmResult = await hook.confirm({
        organizationId: workUnit.organizationId,
        conversationThreadId: params.conversationThreadId,
        operatorId: workUnit.actor.id,
        operatorNote: params.operatorNote,
      });
      return {
        outcome: "completed" as const,
        summary: `Disqualification confirm result: ${result.result}`,
        outputs: { result },
      };
    },
  };
}

export function buildDismissDisqualificationHandler(
  hook: Pick<DisqualificationResolutionHook, "dismiss">,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = DismissDisqualificationParametersSchema.parse(workUnit.parameters);
      const result: HookDismissResult = await hook.dismiss({
        organizationId: workUnit.organizationId,
        conversationThreadId: params.conversationThreadId,
        operatorId: workUnit.actor.id,
        operatorNote: params.operatorNote,
      });
      return {
        outcome: "completed" as const,
        summary: `Disqualification dismiss result: ${result.result}`,
        outputs: { result },
      };
    },
  };
}

export function bootstrapOperatorIntents(deps: OperatorIntentsBootstrapDeps): void {
  const {
    intentRegistry,
    modeRegistry,
    opportunityStore,
    recommendationStore,
    disqualificationHook,
    logger,
  } = deps;

  const handlers = new Map<string, OperatorMutationHandler>([
    [TRANSITION_OPPORTUNITY_STAGE_INTENT, buildTransitionOpportunityStageHandler(opportunityStore)],
  ]);

  if (recommendationStore) {
    handlers.set(
      ACT_ON_RECOMMENDATION_INTENT,
      buildActOnRecommendationHandler(recommendationStore),
    );
  }

  if (disqualificationHook) {
    handlers.set(
      CONFIRM_DISQUALIFICATION_INTENT,
      buildConfirmDisqualificationHandler(disqualificationHook),
    );
    handlers.set(
      DISMISS_DISQUALIFICATION_INTENT,
      buildDismissDisqualificationHandler(disqualificationHook),
    );
  }

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

  if (recommendationStore) {
    intentRegistry.register({
      intent: ACT_ON_RECOMMENDATION_INTENT,
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
  }

  if (disqualificationHook) {
    intentRegistry.register({
      intent: CONFIRM_DISQUALIFICATION_INTENT,
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
    intentRegistry.register({
      intent: DISMISS_DISQUALIFICATION_INTENT,
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
  }

  const intentCount = 1 + (recommendationStore ? 1 : 0) + (disqualificationHook ? 2 : 0);
  logger?.info(
    `Operator mutation mode registered with ${intentCount} operator intent${intentCount === 1 ? "" : "s"}`,
  );
}
