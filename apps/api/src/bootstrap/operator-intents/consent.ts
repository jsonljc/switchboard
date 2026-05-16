// apps/api/src/bootstrap/operator-intents/consent.ts
// ---------------------------------------------------------------------------
// Phase 1b.4 — grant/revoke/clear consent handler factories
// ---------------------------------------------------------------------------
import type { ConsentService } from "@switchboard/core";
import {
  ConsentJurisdictionMismatch,
  ConsentNotesRequired,
  ConsentRevokedCannotRegrant,
  ConsentSystemActorRejected,
  ContactNotFound,
} from "@switchboard/core";
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import {
  ClearConsentParametersSchema,
  GrantConsentParametersSchema,
  RevokeConsentParametersSchema,
} from "../../routes/operator-intents-schemas.js";
import { ADMIN_CONSENT_DEPLOYMENT_ID, OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

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
        // ConsentService.clearConsent typed runtime guards — empty notes or
        // system:-prefix actor. Both are invalid operator input (NOT 500s).
        // Phase 1b.4 review-followup: instanceof-checked typed errors replace
        // the previous brittle substring match on err.message.
        if (err instanceof ConsentNotesRequired || err instanceof ConsentSystemActorRejected) {
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
