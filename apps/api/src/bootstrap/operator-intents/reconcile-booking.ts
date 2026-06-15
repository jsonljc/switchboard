// apps/api/src/bootstrap/operator-intents/reconcile-booking.ts
// receipt.reconcile_booking handler. The owner corrects their own derived read-model: one governed
// intent, three actions (override_attribution / flag_duplicate / resolve_exception), discriminated on
// `action`. system_auto_approved operator-direct, non-financial (no outbound spend, no second
// approver), fully audited via the WorkTrace PlatformIngress writes around the handler.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import type { ApplyReconcileResult } from "@switchboard/db";
import {
  ReconcileBookingParametersSchema,
  type ReconcileBookingParameters,
} from "@switchboard/schemas";
import { OPERATOR_INTENT_ERROR_CODES, RECONCILE_BOOKING_INTENT } from "./shared.js";

export { RECONCILE_BOOKING_INTENT };

/** Minimal writer surface; PrismaReceiptedBookingStore satisfies it structurally. */
export interface ReconcileBookingWriter {
  applyReconcile(input: {
    orgId: string;
    bookingId: string;
    action: ReconcileBookingParameters;
    actorId: string;
    now?: Date;
  }): Promise<ApplyReconcileResult>;
}

export function buildReconcileBookingHandler(
  writer: ReconcileBookingWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = ReconcileBookingParametersSchema.parse(workUnit.parameters);
      // actorId is the AUTHENTICATED actor, never a body field: the override provenance (overriddenBy)
      // must be the real authenticated principal.
      const actorId = workUnit.actor.id;
      const result = await writer.applyReconcile({
        orgId: workUnit.organizationId,
        bookingId: params.bookingId,
        action: params,
        actorId,
      });

      switch (result.status) {
        case "not_found":
          return {
            outcome: "failed" as const,
            summary: `Booking ${params.bookingId} not found for organization`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND,
              message: "Booking not found",
            },
          };
        case "not_issued":
          return {
            outcome: "failed" as const,
            summary: `Booking ${params.bookingId} has no receipted-booking row to reconcile`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.RECEIPTED_BOOKING_NOT_ISSUED,
              message: "Receipted booking not issued",
            },
          };
        case "unsupported_code":
          return {
            outcome: "failed" as const,
            summary: `Reconcile action ${params.action} targeted an unsupported code`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.RECONCILE_UNSUPPORTED_CODE,
              message: "Unsupported reconcile code",
            },
          };
        case "applied":
          return {
            outcome: "completed" as const,
            summary: `Reconciled booking ${params.bookingId} via ${params.action}`,
            outputs: { status: result.status, created: result.created },
          };
      }
    },
  };
}
