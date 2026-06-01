import { z } from "zod";

/** Why Alex scheduled a follow-up (drives WorkTrace evidence + future analytics). */
export const FollowUpReasonSchema = z.enum([
  "hesitation",
  "price_concern",
  "timing_not_now",
  "awaiting_info",
  "went_quiet",
]);
export type FollowUpReason = z.infer<typeof FollowUpReasonSchema>;

/** Coarse cadence the model picks; the server maps it to a concrete dueAt. */
export const FollowUpDelaySchema = z.enum(["in_1_day", "in_3_days", "in_1_week"]);
export type FollowUpDelay = z.infer<typeof FollowUpDelaySchema>;

/** Millisecond offset applied to "now" for each delay. */
export const FOLLOW_UP_DELAY_MS: Record<FollowUpDelay, number> = {
  in_1_day: 24 * 60 * 60 * 1000,
  in_3_days: 3 * 24 * 60 * 60 * 1000,
  in_1_week: 7 * 24 * 60 * 60 * 1000,
};

/** Lifecycle of a queued follow-up. */
export const ScheduledFollowUpStatusSchema = z.enum([
  "pending",
  "sent",
  "skipped",
  "failed",
  "cancelled",
]);
export type ScheduledFollowUpStatus = z.infer<typeof ScheduledFollowUpStatusSchema>;

/** Why a due follow-up was not sent (recorded, never silent). */
export const ProactiveSkipReasonSchema = z.enum([
  "consent_pending",
  "consent_revoked",
  "no_optin",
  "no_template",
  "template_not_approved",
  "marketing_blocked",
  "unsupported_channel",
]);
export type ProactiveSkipReason = z.infer<typeof ProactiveSkipReasonSchema>;
