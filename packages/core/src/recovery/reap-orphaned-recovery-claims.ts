/**
 * Robin no-show recovery crash-orphaned claim reaper (gap P2-13).
 *
 * The pre-send claim `markSendInFlight` clears `nextRetryAt` to NULL while `status` stays "pending",
 * IMMEDIATELY before the WhatsApp Graph send (the at-most-once guard: a failed post-send write can
 * never re-queue the row). If the process dies AFTER the claim but BEFORE a terminal write
 * (markSent / markFailed / markSkipped), the row is stranded: status="pending" + nextRetryAt=NULL.
 * `findDue` selects only rows with a DUE nextRetryAt (SQL `lte` excludes NULL), so the retry cron can
 * never re-select it, and the unique dedupeKey blocks re-engagement of the same (org, booking,
 * no_show). The recovery is invisible and permanently stuck.
 *
 * We CANNOT know whether the Graph send went out before the crash (the claim precedes the network
 * call), so re-sending would risk a double WhatsApp message to a patient (a billing + reputation
 * hazard, and the Cloud API has no idempotency key to dedup a retry). Per
 * `feedback_at_most_once_needs_presend_claim`, stranded-SENT is the SAFE direction: this sweep
 * DEAD-LETTERS the orphan (status="failed") rather than re-queueing it, so a crash can never cause a
 * double-send. The orphan becomes visible + terminal instead of invisible + stuck; re-engagement of a
 * DIFFERENT booking's no-show (a fresh dedupeKey) is unaffected.
 *
 * Per `feedback_reaper_freeing_slot_needs_guarded_claimant`, the recovery write is a status-guarded
 * compare-and-set (`reapOrphanedClaim` filters the current orphan shape; count===0 means a concurrent
 * live sender or a second reaper already terminalized the row). The reaper NEVER triggers a send, so
 * it is double-send-safe by construction; the CAS only prevents it from clobbering a row another
 * writer just moved. Mirrors the stalled-booking reaper (`reapStalledBookings`).
 *
 * Staleness signal: `updatedAt` (Prisma `@updatedAt`, bumped by every write including the claim), so
 * no schema column is needed and both orphan windows are covered (crash after `create` before the
 * claim, and crash after the claim before a terminal write). The 30-minute threshold is far above any
 * legitimate in-flight attempt (a single template send is sub-second), so a live attempt is never
 * reaped out from under itself.
 */

export interface OrphanedRobinRecoverySend {
  id: string;
  organizationId: string;
  contactId: string;
  bookingId: string;
  /** The claim/last-write time; the staleness signal that distinguishes an orphan from a fresh claim. */
  updatedAt: Date;
}

/**
 * The narrow store slice the orphan reaper needs. `PrismaRobinRecoverySendStore` satisfies it
 * structurally; kept separate from `RobinRecoverySendStore` so the send/retry executors and their
 * mocks are untouched.
 */
export interface OrphanedClaimReaperStore {
  /** Stale orphans: status="pending" AND nextRetryAt IS NULL AND updatedAt < olderThan. */
  findOrphanedClaims(olderThan: Date, limit: number): Promise<OrphanedRobinRecoverySend[]>;
  /**
   * Status-guarded CAS dead-letter, scoped to the owning organizationId (audit §10). count===1 = this
   * run aged the orphan to failed; count===0 = a concurrent confirm/fail/skip or another reaper
   * terminalized it first (benign race). Re-asserts the full orphan shape (incl. the staleness floor)
   * so the write is correct even if the scan snapshot is stale.
   */
  reapOrphanedClaim(
    id: string,
    organizationId: string,
    olderThan: Date,
  ): Promise<{ count: number }>;
}

export interface ReapOrphanedRecoveryClaimsDeps {
  store: OrphanedClaimReaperStore;
  /** Injectable clock for tests; defaults to wall clock. */
  now?: () => Date;
}

export interface ReapOrphanedRecoveryClaimsConfig {
  /** Age floor: only pending+null rows whose updatedAt is older than (now - this) are reaped. */
  olderThanMs: number;
  /** Upper bound on rows scanned/aged per run. */
  limit: number;
}

export interface ReapOrphanedRecoveryClaimsResult {
  /** Stale orphaned claims found this run. */
  scanned: number;
  /** Orphans aged to failed by our CAS (count===1). */
  reaped: number;
  /** Orphans a concurrent writer terminalized between scan and our CAS (count===0). Benign. */
  raced: number;
  /** Orphans whose CAS THREW (a hard store error); left for the next run. */
  failed: number;
}

/**
 * 30 minutes: far above any legitimate in-flight send. A recovery row resolves pending -> a terminal
 * state within one send attempt (the Graph call is sub-second), so a row still pending + nextRetryAt
 * NULL after this is stranded. Mirrors STALLED_BOOKING_MAX_AGE_MS.
 */
export const ROBIN_RECOVERY_ORPHAN_MAX_AGE_MS = 30 * 60 * 1000;

/** Bounded batch per run; the sweep never fans out unbounded on a mass strand. */
export const ROBIN_RECOVERY_ORPHAN_REAP_LIMIT = 500;

/**
 * Detect + dead-letter crash-orphaned recovery claims. Double-send-safe: it only ever writes
 * status="failed" via a guarded CAS, and never re-queues or sends. A per-row CAS throw is isolated
 * (counted, logged, left for the next run); a scan throw propagates so the cron onFailure handler can
 * alert.
 */
export async function reapOrphanedRecoveryClaims(
  deps: ReapOrphanedRecoveryClaimsDeps,
  config: ReapOrphanedRecoveryClaimsConfig,
): Promise<ReapOrphanedRecoveryClaimsResult> {
  const now = deps.now?.() ?? new Date();
  const olderThan = new Date(now.getTime() - config.olderThanMs);

  const orphans = await deps.store.findOrphanedClaims(olderThan, config.limit);
  let reaped = 0;
  let raced = 0;
  let failed = 0;

  for (const orphan of orphans) {
    try {
      const { count } = await deps.store.reapOrphanedClaim(
        orphan.id,
        orphan.organizationId,
        olderThan,
      );
      if (count === 0) {
        // A concurrent live sender (markSent/markFailed/markSkipped) or another reaper moved the row
        // between our scan and CAS. It is now properly terminal; nothing to do, NOT a re-send.
        raced++;
        console.warn(
          `[robin-recovery-orphan-reaper] rowId=${orphan.id} org=${orphan.organizationId} was ` +
            `terminalized by a concurrent send/reaper between scan and CAS; skipping (no re-send)`,
        );
        continue;
      }
      reaped++;
      // Per-row audit line: each dead-lettered orphan is in logs (the send may already have gone out).
      console.warn(
        `[robin-recovery-orphan-reaper] dead-lettered crash-orphaned recovery claim rowId=${orphan.id} ` +
          `org=${orphan.organizationId} contact=${orphan.contactId} booking=${orphan.bookingId} ` +
          `updatedAt=${orphan.updatedAt.toISOString()} -> failed (the send MAY have gone out; NOT ` +
          `re-sent, at-most-once)`,
      );
    } catch (err) {
      failed++;
      console.error(
        `[robin-recovery-orphan-reaper] CAS threw for rowId=${orphan.id} ` +
          `org=${orphan.organizationId}; left for the next sweep`,
        err,
      );
    }
  }

  return { scanned: orphans.length, reaped, raced, failed };
}
