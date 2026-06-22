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

/**
 * Welds a booking's calendar receipt status to attendance: promote booked -> held on "attended",
 * and the inverse demote held -> booked on "no_show" (when a prior "attended" is corrected), so the
 * proof receipt never overstates attendance. PrismaReceiptStore satisfies it structurally. Optional:
 * when unwired the handler still records attendance, it just does not weld the receipt primitive.
 */
export interface ReceiptHeldPromoter {
  promoteCalendarBookedToHeld(organizationId: string, bookingId: string): Promise<number>;
  demoteCalendarHeldToBooked(organizationId: string, bookingId: string): Promise<number>;
}

export function buildRecordAttendanceHandler(
  writer: BookingAttendanceWriter,
  receiptPromoter?: ReceiptHeldPromoter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = RecordAttendanceParametersSchema.parse(workUnit.parameters);
      let booking: { id: string; attendance: string | null };
      try {
        booking = await writer.recordAttendance(
          workUnit.organizationId,
          params.bookingId,
          params.outcome,
        );
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

      // Attendance is the source of truth (and is already persisted). Welding the calendar receipt
      // status is a secondary proof write: promote booked -> held on "attended", and the inverse
      // demote held -> booked on "no_show" so a corrected attendance never leaves the receipt
      // overstating the visit. A failure here propagates (fail loud) rather than silently desyncing
      // the receipt; recordAttendance is idempotent on (id, org), so retrying the whole action is safe.
      let receiptsPromoted = 0;
      let receiptsDemoted = 0;
      if (receiptPromoter && params.outcome === "attended") {
        receiptsPromoted = await receiptPromoter.promoteCalendarBookedToHeld(
          workUnit.organizationId,
          params.bookingId,
        );
      } else if (receiptPromoter && params.outcome === "no_show") {
        receiptsDemoted = await receiptPromoter.demoteCalendarHeldToBooked(
          workUnit.organizationId,
          params.bookingId,
        );
      }

      return {
        outcome: "completed" as const,
        summary: `Recorded ${params.outcome} for booking ${params.bookingId}`,
        outputs: { booking, receiptsPromoted, receiptsDemoted },
      };
    },
  };
}
