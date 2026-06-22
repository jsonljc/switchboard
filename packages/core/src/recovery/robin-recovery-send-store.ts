export interface CreateRobinRecoverySendInput {
  organizationId: string;
  contactId: string;
  bookingId: string;
  campaignKind: string;
  campaignWorkUnitId?: string | null;
  dedupeKey: string;
}

/**
 * A RobinRecoverySend row that is due for a retry attempt. Produced by `findDue` and consumed by
 * the retry cron, which submits one PlatformIngress call per row using the seeded system principal.
 */
export interface DueRobinRecoverySend {
  id: string;
  organizationId: string;
  contactId: string;
  bookingId: string;
  campaignKind: string;
  attempts: number;
}

/**
 * Maximum total send attempts per RobinRecoverySend row (1 cohort attempt + 2 retries). After the
 * third attempt fails, the row is dead-lettered (status=failed, nextRetryAt cleared).
 */
export const ROBIN_RECOVERY_MAX_SEND_ATTEMPTS = 3;

/**
 * Base backoff window for capped-exponential + full-jitter retry (15 minutes). At attempt 0, jitter
 * is drawn from [0, 15m); at attempt 1 from [0, 30m), capped by ROBIN_RECOVERY_RETRY_CAP_MS.
 */
export const ROBIN_RECOVERY_RETRY_BASE_MS = 15 * 60 * 1000;

/**
 * Maximum delay cap for the capped-exponential backoff (6 hours). Recovery is time-sensitive, so
 * the cap is shorter than the ScheduledFollowUp prior art.
 */
export const ROBIN_RECOVERY_RETRY_CAP_MS = 6 * 60 * 60 * 1000;

/**
 * Stale-row guard: findDue ignores rows older than 24 hours. A row older than this is presumed
 * irrelevant (the contact window has closed) and will never be reclaimed by the retry cron.
 */
export const ROBIN_RECOVERY_RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Idempotent no-show recovery send log. The recovery executor is the only producer/consumer.
 * Claim-first: `create` inserts a pending row keyed by the unique dedupeKey; a P2002 on a duplicate
 * means the no-show was already contacted, so the executor swallows it and SKIPS (never re-sends).
 * Bounded retry: markFailed re-queues (status pending + nextRetryAt) until attempts reach
 * ROBIN_RECOVERY_MAX_SEND_ATTEMPTS, then dead-letters (status failed). findDue reclaims only
 * EXPLICITLY-rescheduled rows (nextRetryAt set); fresh rows belong to the cohort executor.
 */
export interface RobinRecoverySendStore {
  create(input: CreateRobinRecoverySendInput): Promise<{ id: string }>;
  markSent(id: string, messageId: string | null): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void>;
  findDue(now: Date, limit: number): Promise<DueRobinRecoverySend[]>;
}
