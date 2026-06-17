// apps/api/src/bootstrap/operator-intents/erase-contact.ts
// operator.erase_contact handler. An operator who receives a stop-contacting / right-to-erasure
// request by phone or email fulfils it here: one governed, system_auto_approved operator-direct
// intent that runs the SAME full delete cascade as the Meta data-deletion callback
// (eraseContactFully), org-scoped and fail-closed against cross-tenant erasure. Non-financial (no
// outbound spend, no second approver); fully audited via the WorkTrace PlatformIngress writes
// around the handler PLUS a durable DataDeletionRequest row (so the legal record of the erasure
// survives independent of the WorkTrace retention window).
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { z } from "zod";
import { OPERATOR_INTENT_ERROR_CODES, ERASE_CONTACT_INTENT } from "./shared.js";

export { ERASE_CONTACT_INTENT };

/** Parameter schema for operator.erase_contact. The contactId is the only input; the org is the
 *  authenticated org (ingress-authoritative), never a body field. */
export const EraseContactParametersSchema = z.object({
  contactId: z.string().min(1),
});
export type EraseContactParameters = z.infer<typeof EraseContactParametersSchema>;

/** Outcome status persisted to the DataDeletionRequest audit row. */
export type EraseRequestStatus = "completed" | "failed";

/**
 * The seam the handler drives. A Prisma-backed adapter (see app.ts) satisfies it: it wraps the
 * existing `eraseContactFully` cascade, an org-scoped existence read, and the DataDeletionRequest
 * audit write. Kept as a single injected port (not three) so the handler has one dependency and
 * the route test can inject one fake.
 */
export interface OperatorContactEraser {
  /** Org-scoped existence check. Returns true iff a contact with `contactId` belongs to `orgId`.
   *  This is the fail-closed cross-tenant guard: a contact owned by another org reads false. */
  findContactForOrg(orgId: string, contactId: string): Promise<boolean>;
  /** Run the full PII delete cascade for this contact (eraseContactFully): cancel external
   *  calendar events, then delete the contact graph + WorkTrace + DLQ rows. */
  erase(orgId: string, contactId: string): Promise<void>;
  /** Persist the durable audit record of the erasure request (a DataDeletionRequest row tagged as
   *  operator-initiated). */
  recordRequest(input: {
    orgId: string;
    contactId: string;
    actorId: string;
    status: EraseRequestStatus;
    failureReason?: string;
  }): Promise<void>;
}

export function buildEraseContactHandler(eraser: OperatorContactEraser): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = EraseContactParametersSchema.parse(workUnit.parameters);
      const orgId = workUnit.organizationId;
      // actorId is the AUTHENTICATED actor (the operator), never a body field: the audit row's
      // provenance must be the real authenticated principal.
      const actorId = workUnit.actor.id;

      // Fail-closed org-scope gate: if the contact does not belong to the authenticated org, do
      // NOT run the cascade. A cross-tenant contact reads as not-found here.
      const exists = await eraser.findContactForOrg(orgId, params.contactId);
      if (!exists) {
        return {
          outcome: "failed" as const,
          summary: `Contact ${params.contactId} not found for organization`,
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.CONTACT_NOT_FOUND,
            message: "Contact not found",
          },
        };
      }

      // Run the full delete cascade. On failure, still persist a "failed" audit row (the request
      // was received and attempted — the legal record must reflect that) and then re-throw so the
      // operator sees a 500 and ops can reconcile a partial erasure from the logs.
      try {
        await eraser.erase(orgId, params.contactId);
      } catch (err) {
        await eraser.recordRequest({
          orgId,
          contactId: params.contactId,
          actorId,
          status: "failed",
          failureReason: err instanceof Error ? err.message : "unknown_error",
        });
        throw err;
      }

      await eraser.recordRequest({
        orgId,
        contactId: params.contactId,
        actorId,
        status: "completed",
      });

      return {
        outcome: "completed" as const,
        summary: `Erased contact ${params.contactId} (PDPA operator request)`,
        outputs: { contactId: params.contactId, status: "erased" },
      };
    },
  };
}
