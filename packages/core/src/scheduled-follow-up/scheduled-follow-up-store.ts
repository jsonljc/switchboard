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
  note: string | null;
  templateIntentClass: string;
  dueAt: Date;
  dedupeKey: string;
  /** Cadence position (touch 1 = the producer-scheduled first touch). */
  touchNumber: number;
  /** Episode id shared by all touches of one cadence; null = legacy one-and-done (never advanced). */
  cadenceId: string | null;
}

/** Minimal projection the firing cron needs per due row. */
export interface DueScheduledFollowUp {
  id: string;
  organizationId: string;
  contactId: string;
  conversationThreadId: string | null;
  sessionId: string | null;
  deploymentId: string | null;
  workUnitId: string | null;
  channel: string;
  jurisdiction: string | null;
  reason: string;
  note: string | null;
  templateIntentClass: string;
  attempts: number;
  dueAt: Date;
  touchNumber: number;
  cadenceId: string | null;
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
  /** Activation skip (e.g. template pending approval): stay pending + re-eval
   * later WITHOUT consuming a send attempt or advancing the cadence. */
  markDeferred(id: string, reason: string, nextRetryAt: Date): Promise<void>;
  /** nextRetryAt set → re-queues (status back to pending); null → terminal failed. */
  markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void>;
}
