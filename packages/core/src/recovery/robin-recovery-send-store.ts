export interface CreateRobinRecoverySendInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  campaignKind: string;
  campaignWorkUnitId?: string | null;
  dedupeKey: string;
}

/**
 * Idempotent no-show recovery send log. The recovery executor is the only producer/consumer.
 * Claim-first: `create` inserts a pending row keyed by the unique dedupeKey; a P2002 on a duplicate
 * means the no-show was already contacted, so the executor swallows it and SKIPS (never re-sends).
 * Single-attempt: markFailed is terminal (no retry), mirroring ScheduledReminderStore.
 */
export interface RobinRecoverySendStore {
  create(input: CreateRobinRecoverySendInput): Promise<{ id: string }>;
  markSent(id: string, messageId: string | null): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
