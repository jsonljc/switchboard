import type { ToolResult } from "../tool-result.js";
import { fail } from "../tool-result.js";

export interface ParsedSlotWindow {
  startsAt: Date;
  endsAt: Date;
}

const INVALID_SLOT_REMEDIATION =
  "Re-issue the booking with slotStart and slotEnd as valid ISO 8601 datetimes " +
  "(for example 2026-07-01T14:00:00Z) where slotEnd is after slotStart. " +
  "Do not tell the lead the appointment is confirmed.";

/**
 * Validate the LLM-supplied slot window BEFORE any store or calendar-provider
 * call. The coarse runtime input guard only checks string type / min-length, so a
 * non-empty but unparseable date string ("next tuesday", "") reaches the tool and
 * would otherwise become an Invalid Date that throws at the Prisma booking write
 * (booking.create) or at .toISOString() (a RangeError) and kill the whole Alex
 * turn. Returning a structured, retryable fail lets the model re-offer a valid
 * slot instead. Shared by calendar-book.booking.create and
 * calendar-reschedule.booking.reschedule so the two paths validate identically.
 */
export function parseSlotWindowOrFail(
  slotStart: string,
  slotEnd: string,
): { window: ParsedSlotWindow } | { failure: ToolResult } {
  const startsAt = new Date(slotStart);
  const endsAt = new Date(slotEnd);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return {
      failure: fail("INVALID_SLOT", "The appointment time was not a valid date.", {
        retryable: true,
        modelRemediation: INVALID_SLOT_REMEDIATION,
      }),
    };
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return {
      failure: fail("INVALID_SLOT", "The appointment end time must be after the start time.", {
        retryable: true,
        modelRemediation: INVALID_SLOT_REMEDIATION,
      }),
    };
  }
  return { window: { startsAt, endsAt } };
}
