/** Input to enqueue a follow-up. */
export interface CreateScheduledFollowUpInput {
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  sessionId: string | null;
  deploymentId: string | null;
  workUnitId: string | null;
  channel: string;
  jurisdiction: string | null;
  reason: string;
  templateIntentClass: string;
  dueAt: Date;
  dedupeKey: string;
}

/** Minimal projection the firing cron needs per due row. */
export interface DueScheduledFollowUp {
  id: string;
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  channel: string;
  templateIntentClass: string;
  reason: string;
  attempts: number;
}

/**
 * Durable queue for Alex-scheduled re-engagement nudges. Implemented in
 * @switchboard/db. The firing cron is the only consumer; the schedule tool is
 * the only producer.
 */
export interface ScheduledFollowUpStore {
  create(input: CreateScheduledFollowUpInput): Promise<{ id: string }>;
  /** ≤1 pending follow-up per contact (the schedule-time rate guard). */
  findPendingForContact(organizationId: string, contactId: string): Promise<{ id: string } | null>;
  findDue(now: Date, limit: number): Promise<DueScheduledFollowUp[]>;
  markSent(id: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  /** nextRetryAt set → re-queues (status back to pending); null → terminal failed. */
  markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void>;
}
