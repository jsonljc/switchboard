import { z } from "zod";

export const ScheduledReminderStatusSchema = z.enum(["pending", "sent", "skipped", "failed"]);
export type ScheduledReminderStatus = z.infer<typeof ScheduledReminderStatusSchema>;

/**
 * Reschedule-safe dedupe key. Keyed on the EXACT startsAt — if a booking moves,
 * the key changes and a fresh reminder fires for the new time. (bookingId alone
 * would suppress the reminder for the rescheduled slot.)
 */
export function buildReminderDedupeKey(bookingId: string, startsAt: Date): string {
  return `reminder:${bookingId}:${startsAt.toISOString()}`;
}
