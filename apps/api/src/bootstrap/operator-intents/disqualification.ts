// apps/api/src/bootstrap/operator-intents/disqualification.ts
// ---------------------------------------------------------------------------
// Phase 1b.3 — confirm/dismiss disqualification handler factories
// ---------------------------------------------------------------------------
import type {
  DisqualificationResolutionHook,
  HookConfirmResult,
  HookDismissResult,
} from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import {
  ConfirmDisqualificationParametersSchema,
  DismissDisqualificationParametersSchema,
} from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

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
