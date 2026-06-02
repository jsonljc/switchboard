import {
  NEXT_TOUCH_GAP_DAYS,
  MAX_CADENCE_TOUCHES,
  MIN_NEXT_TOUCH_GAP_MS,
  buildFollowUpDedupeKey,
} from "@switchboard/schemas";
import type {
  CreateScheduledFollowUpInput,
  DueScheduledFollowUp,
} from "./scheduled-follow-up-store.js";

/**
 * Given a just-SENT cadence touch, build the next touch's create input — or
 * null if the cadence is complete or this is a legacy one-and-done row.
 * Send-relative: anchored on `now` (≈ the row's just-written sentAt), so a
 * delayed send STRETCHES the cadence, never compresses it. Day-bucketed dedupe
 * key keeps it idempotent across cron retries within a day.
 */
export function buildNextCadenceTouch(
  row: DueScheduledFollowUp,
  now: Date,
): CreateScheduledFollowUpInput | null {
  if (row.cadenceId === null) return null;
  if (row.touchNumber >= MAX_CADENCE_TOUCHES) return null;
  const gapDays = NEXT_TOUCH_GAP_DAYS[row.touchNumber];
  if (gapDays === undefined) return null;
  const gapMs = gapDays * 24 * 60 * 60 * 1000;
  const nextDueAt = new Date(now.getTime() + Math.max(gapMs, MIN_NEXT_TOUCH_GAP_MS));
  const touchNumber = row.touchNumber + 1;
  return {
    organizationId: row.organizationId,
    contactId: row.contactId,
    conversationThreadId: row.conversationThreadId,
    sessionId: row.sessionId,
    deploymentId: row.deploymentId,
    workUnitId: row.workUnitId,
    channel: row.channel,
    jurisdiction: row.jurisdiction,
    reason: row.reason,
    note: row.note,
    templateIntentClass: row.templateIntentClass,
    dueAt: nextDueAt,
    dedupeKey: buildFollowUpDedupeKey(row.organizationId, row.contactId, nextDueAt, touchNumber),
    touchNumber,
    cadenceId: row.cadenceId,
  };
}
