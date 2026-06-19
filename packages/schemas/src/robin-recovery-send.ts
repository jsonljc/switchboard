import { z } from "zod";

export const RobinRecoverySendStatusSchema = z.enum(["pending", "sent", "skipped", "failed"]);
export type RobinRecoverySendStatus = z.infer<typeof RobinRecoverySendStatusSchema>;

/**
 * Deterministic per-(org, booking, campaign-kind) dedup key for a recovery send. A no-show booking
 * is a one-time past event, so one key per booking gives v1's single conservative recovery attempt:
 * re-runs and overlapping weekly campaigns dedup to one contact. Mirrors buildReminderDedupeKey.
 * bookingId is globally unique (uuid); org + kind are included for explicit per-(org, booking, kind)
 * scoping and forward-compat with future campaign kinds (cancellation recovery, etc.).
 */
export function buildRecoveryDedupeKey(
  organizationId: string,
  bookingId: string,
  campaignKind: string,
): string {
  return `recovery:${campaignKind}:${organizationId}:${bookingId}`;
}
