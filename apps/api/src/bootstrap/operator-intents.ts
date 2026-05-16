import { transitionOpportunityStage, OpportunityNotFoundError } from "@switchboard/core/lifecycle";
import type {
  ConsentService,
  OpportunityStore,
  RecommendationStore,
  DisqualificationResolutionHook,
  HookConfirmResult,
  HookDismissResult,
} from "@switchboard/core";
import {
  actOnRecommendation,
  ConsentJurisdictionMismatch,
  ConsentRevokedCannotRegrant,
  ContactNotFound,
} from "@switchboard/core";
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
  GrantConsentParametersSchema,
  RevokeConsentParametersSchema,
  ClearConsentParametersSchema,
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
  /** Optional: handler+intent only registered when provided. */
  opportunityStore?: OpportunityStore;
  recommendationStore?: RecommendationStore;
  disqualificationHook?: Pick<DisqualificationResolutionHook, "confirm" | "dismiss">;
  consentService?: ConsentService;
  logger?: { info(msg: string): void };
}

export const TRANSITION_OPPORTUNITY_STAGE_INTENT = "operator.transition_opportunity_stage";
export const ACT_ON_RECOMMENDATION_INTENT = "operator.act_on_recommendation";
export const CONFIRM_DISQUALIFICATION_INTENT = "operator.confirm_disqualification";
export const DISMISS_DISQUALIFICATION_INTENT = "operator.dismiss_disqualification";
export const GRANT_CONSENT_INTENT = "operator.grant_consent";
export const REVOKE_CONSENT_INTENT = "operator.revoke_consent";
export const CLEAR_CONSENT_INTENT = "operator.clear_consent";

/**
 * Sentinel deployment ID used for admin-consent verdict context. The admin
 * endpoint is not a real deployment; this literal preserves the audit-trail
 * tagging that pre-dated the ingress migration (Phase 1b.4).
 */
const ADMIN_CONSENT_DEPLOYMENT_ID = "system:admin-endpoint";

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
  DISQUALIFICATION_HOOK_THROW: "DISQUALIFICATION_HOOK_THROW",
  CONSENT_NOT_FOUND: "CONSENT_NOT_FOUND",
  CONSENT_INVALID_JURISDICTION: "CONSENT_INVALID_JURISDICTION",
  CONSENT_REVOKED_CANNOT_REGRANT: "CONSENT_REVOKED_CANNOT_REGRANT",
  CONSENT_OPERATION_FAILED: "CONSENT_OPERATION_FAILED",
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

      let result: HookConfirmResult;
      try {
        result = await hook.confirm({
          organizationId: workUnit.organizationId,
          conversationThreadId: params.conversationThreadId,
          operatorId: workUnit.actor.id,
          operatorNote: params.operatorNote,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[confirm_disqualification] hook threw for thread ${params.conversationThreadId}: ${msg}`,
        );
        return {
          outcome: "failed" as const,
          summary: "Disqualification hook threw unexpectedly",
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_HOOK_THROW,
            message: msg,
          },
        };
      }

      if (result.result === "confirmed") {
        return {
          outcome: "completed" as const,
          summary: "Disqualification confirmed",
          outputs: { result: "confirmed" },
        };
      }
      if (result.result === "already_applied") {
        return {
          outcome: "completed" as const,
          summary: "Disqualification already applied (idempotent re-confirm)",
          outputs: { result: "confirmed", alreadyApplied: true },
        };
      }
      if (result.result === "not_found" || result.result === "capability_disabled") {
        return {
          outcome: "failed" as const,
          summary: `Disqualification confirm: ${result.result}`,
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_NOT_FOUND,
            message: result.result,
          },
        };
      }
      // result.result === "conflict" — reason is "already_booked"|"not_proposed"|"already_disqualified"
      return {
        outcome: "failed" as const,
        summary: `Disqualification confirm conflict: ${result.reason}`,
        error: {
          code: OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_CONFLICT,
          message: result.reason,
        },
        outputs: { reason: result.reason },
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

      let result: HookDismissResult;
      try {
        result = await hook.dismiss({
          organizationId: workUnit.organizationId,
          conversationThreadId: params.conversationThreadId,
          operatorId: workUnit.actor.id,
          operatorNote: params.operatorNote,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[dismiss_disqualification] hook threw for thread ${params.conversationThreadId}: ${msg}`,
        );
        return {
          outcome: "failed" as const,
          summary: "Disqualification hook threw unexpectedly",
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_HOOK_THROW,
            message: msg,
          },
        };
      }

      if (result.result === "dismissed") {
        return {
          outcome: "completed" as const,
          summary: `Disqualification dismissed, restored to: ${result.restoredStatus}`,
          outputs: { result: "dismissed", restoredStatus: result.restoredStatus },
        };
      }
      if (result.result === "not_found" || result.result === "capability_disabled") {
        return {
          outcome: "failed" as const,
          summary: `Disqualification dismiss: ${result.result}`,
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_NOT_FOUND,
            message: result.result,
          },
        };
      }
      // result.result === "conflict" — reason is "not_proposed"
      return {
        outcome: "failed" as const,
        summary: `Disqualification dismiss conflict: ${result.reason}`,
        error: {
          code: OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_CONFLICT,
          message: result.reason,
        },
        outputs: { reason: result.reason },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 1b.4 — admin-consent handler factories
// ---------------------------------------------------------------------------

export function buildGrantConsentHandler(consentService: ConsentService): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = GrantConsentParametersSchema.parse(workUnit.parameters);
      try {
        await consentService.recordGrant({
          contactId: params.contactId,
          jurisdiction: params.jurisdiction,
          source: params.source,
          grantedAt: new Date(params.grantedAt),
          actor: params.actor,
          notes: params.notes,
          organizationId: workUnit.organizationId,
          deploymentId: ADMIN_CONSENT_DEPLOYMENT_ID,
        });
        return {
          outcome: "completed" as const,
          summary: `Consent granted for ${params.contactId}`,
          outputs: { contactId: params.contactId },
        };
      } catch (err) {
        if (err instanceof ContactNotFound) {
          return {
            outcome: "failed" as const,
            summary: "Contact not found",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND,
              message: err.message,
            },
            outputs: { contactId: err.contactId },
          };
        }
        if (err instanceof ConsentJurisdictionMismatch) {
          return {
            outcome: "failed" as const,
            summary: "Consent jurisdiction mismatch",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.CONSENT_INVALID_JURISDICTION,
              message: err.message,
            },
            outputs: {
              contactId: err.contactId,
              stamped: err.stamped,
              provided: err.provided,
            },
          };
        }
        if (err instanceof ConsentRevokedCannotRegrant) {
          return {
            outcome: "failed" as const,
            summary: "Consent revoked — cannot regrant",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.CONSENT_REVOKED_CANNOT_REGRANT,
              message: err.message,
            },
            outputs: {
              contactId: err.contactId,
              revokedAt: err.revokedAt.toISOString(),
            },
          };
        }
        throw err;
      }
    },
  };
}

export function buildRevokeConsentHandler(consentService: ConsentService): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RevokeConsentParametersSchema.parse(workUnit.parameters);
      try {
        await consentService.recordRevocation({
          contactId: params.contactId,
          source: params.source,
          revokedAt: new Date(params.revokedAt),
          actor: params.actor,
          notes: params.notes,
          organizationId: workUnit.organizationId,
          deploymentId: ADMIN_CONSENT_DEPLOYMENT_ID,
        });
        return {
          outcome: "completed" as const,
          summary: `Consent revoked for ${params.contactId}`,
          outputs: { contactId: params.contactId },
        };
      } catch (err) {
        if (err instanceof ContactNotFound) {
          return {
            outcome: "failed" as const,
            summary: "Contact not found",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND,
              message: err.message,
            },
            outputs: { contactId: err.contactId },
          };
        }
        throw err;
      }
    },
  };
}

export function buildClearConsentHandler(consentService: ConsentService): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = ClearConsentParametersSchema.parse(workUnit.parameters);
      try {
        await consentService.clearConsent({
          contactId: params.contactId,
          actor: params.actor,
          notes: params.notes,
          organizationId: workUnit.organizationId,
          deploymentId: ADMIN_CONSENT_DEPLOYMENT_ID,
        });
        return {
          outcome: "completed" as const,
          summary: `Consent cleared for ${params.contactId}`,
          outputs: { contactId: params.contactId },
        };
      } catch (err) {
        if (err instanceof ContactNotFound) {
          return {
            outcome: "failed" as const,
            summary: "Contact not found",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.CONSENT_NOT_FOUND,
              message: err.message,
            },
            outputs: { contactId: err.contactId },
          };
        }
        // ConsentService.clearConsent runtime guards: plain Error with "notes"
        // (empty audit-trail notes) or "system:" (system-prefix actor rejection).
        // Both should NOT bubble as 500 — they represent invalid operator input.
        if (
          err instanceof Error &&
          (err.message.includes("notes") || err.message.includes("system:"))
        ) {
          return {
            outcome: "failed" as const,
            summary: "Invalid actor or notes for clear consent",
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.CONSENT_OPERATION_FAILED,
              message: err.message,
            },
            outputs: { contactId: params.contactId },
          };
        }
        throw err;
      }
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
    consentService,
    logger,
  } = deps;

  const handlers = new Map<string, OperatorMutationHandler>();

  if (opportunityStore) {
    handlers.set(
      TRANSITION_OPPORTUNITY_STAGE_INTENT,
      buildTransitionOpportunityStageHandler(opportunityStore),
    );
  }

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

  if (consentService) {
    handlers.set(GRANT_CONSENT_INTENT, buildGrantConsentHandler(consentService));
    handlers.set(REVOKE_CONSENT_INTENT, buildRevokeConsentHandler(consentService));
    handlers.set(CLEAR_CONSENT_INTENT, buildClearConsentHandler(consentService));
  }

  modeRegistry.register(new OperatorMutationMode({ handlers }));

  if (opportunityStore) {
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
  }

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

  if (consentService) {
    for (const intent of [GRANT_CONSENT_INTENT, REVOKE_CONSENT_INTENT, CLEAR_CONSENT_INTENT]) {
      intentRegistry.register({
        intent,
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
  }

  const intentCount =
    (opportunityStore ? 1 : 0) +
    (recommendationStore ? 1 : 0) +
    (disqualificationHook ? 2 : 0) +
    (consentService ? 3 : 0);
  logger?.info(
    `Operator mutation mode registered with ${intentCount} operator intent${intentCount === 1 ? "" : "s"}`,
  );
}
