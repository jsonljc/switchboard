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

/** Touch 1 fires +2d after the lead defers (the "+2" in +2/+5/+12). */
export const CADENCE_TOUCH1_DELAY_MS = 2 * 24 * 60 * 60 * 1000;
/** Send-relative gap to the NEXT touch, keyed by the just-sent touchNumber. */
export const NEXT_TOUCH_GAP_DAYS: Record<number, number> = { 1: 3, 2: 7 };
/** Stop after 3 touches. */
export const MAX_CADENCE_TOUCHES = 3;
/** Never schedule the next touch sooner than 48h out (compression floor). */
export const MIN_NEXT_TOUCH_GAP_MS = 48 * 60 * 60 * 1000;
/** Relaxed re-eval interval for an activation skip (template not yet approved). */
export const ACTIVATION_RETRY_INTERVAL_MS = 60 * 60 * 1000;
/** Past this much overdue, an unsent activation-skipped touch terminates as stale. */
export const ACTIVATION_MAX_OVERDUE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Stable, day-bucketed dedupe key for a cadence touch. The `:t${touchNumber}`
 * suffix makes touches collision-proof even when two land on the same calendar
 * day; the day bucket keeps it idempotent across cron retries within a day.
 */
export function buildFollowUpDedupeKey(
  organizationId: string,
  contactId: string,
  dueAt: Date,
  touchNumber: number,
): string {
  const dayBucket = dueAt.toISOString().slice(0, 10);
  return `followup:${organizationId}:${contactId}:${dayBucket}:t${touchNumber}`;
}

const ACTIVATION_SKIP_REASONS = new Set<string>(["template_not_approved", "no_template"]);

/**
 * Cadence skip taxonomy. Only activation skips (template pending Meta approval)
 * keep a row re-evaluable; everything else — durable ineligibility AND any
 * unrecognised reason — terminates the cadence (fail-closed; never loops).
 */
export function classifyCadenceSkip(reason: string): "durable" | "activation" {
  return ACTIVATION_SKIP_REASONS.has(reason) ? "activation" : "durable";
}
