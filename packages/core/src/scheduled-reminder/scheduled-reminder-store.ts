export interface CreateScheduledReminderInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  startsAt: Date;
  timezone: string;
  channel: string;
  templateIntentClass: string;
  dedupeKey: string;
}

/** Existing-row probe used by the cron to decide skip/create/resubmit. */
export interface ScheduledReminderProbe {
  id: string;
  status: string;
}

/**
 * Idempotent reminder queue. The reminder cron is the only producer/consumer.
 * Single-attempt: markFailed is terminal (no retry).
 */
export interface ScheduledReminderStore {
  create(input: CreateScheduledReminderInput): Promise<{ id: string }>;
  findByDedupeKey(dedupeKey: string): Promise<ScheduledReminderProbe | null>;
  markSent(id: string): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
