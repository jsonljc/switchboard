// apps/api/src/bootstrap/operator-intents/attendance.ts
// booking.record_attendance handler -- operator/staff records attended | no_show.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import { StaleVersionError } from "@switchboard/core";
import { RecordAttendanceParametersSchema } from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

/** Minimal writer surface; PrismaBookingStore satisfies it structurally. */
export interface BookingAttendanceWriter {
  recordAttendance(
    organizationId: string,
    bookingId: string,
    outcome: string,
  ): Promise<{ id: string; attendance: string | null }>;
}

export function buildRecordAttendanceHandler(
  writer: BookingAttendanceWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordAttendanceParametersSchema.parse(workUnit.parameters);
      try {
        const booking = await writer.recordAttendance(
          workUnit.organizationId,
          params.bookingId,
          params.outcome,
        );
        return {
          outcome: "completed" as const,
          summary: `Recorded ${params.outcome} for booking ${params.bookingId}`,
          outputs: { booking },
        };
      } catch (err) {
        if (err instanceof StaleVersionError) {
          return {
            outcome: "failed" as const,
            summary: `Booking ${params.bookingId} not found for organization`,
            error: {
              code: OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND,
              message: "Booking not found",
            },
          };
        }
        throw err;
      }
    },
  };
}
