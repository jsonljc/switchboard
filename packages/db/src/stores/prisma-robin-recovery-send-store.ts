import type { PrismaClient } from "@prisma/client";
import type {
  CreateRobinRecoverySendInput,
  RobinRecoverySendStore,
  DueRobinRecoverySend,
} from "@switchboard/core";
import {
  ROBIN_RECOVERY_MAX_SEND_ATTEMPTS,
  ROBIN_RECOVERY_RETRY_MAX_AGE_MS,
} from "@switchboard/core";

export class PrismaRobinRecoverySendStore implements RobinRecoverySendStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRobinRecoverySendInput): Promise<{ id: string }> {
    // Claim-first INSERT; the unique dedupeKey makes a duplicate throw P2002, which the executor
    // swallows to SKIP (never re-send). The throw is intentional control flow, not an error here.
    const row = await this.prisma.robinRecoverySend.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        bookingId: input.bookingId,
        campaignKind: input.campaignKind,
        campaignWorkUnitId: input.campaignWorkUnitId ?? null,
        dedupeKey: input.dedupeKey,
        status: "pending",
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findDue(now: Date, limit: number): Promise<DueRobinRecoverySend[]> {
    // Retry-cron reclaim: ONLY explicitly-rescheduled rows (nextRetryAt set + due). Fresh cohort rows
    // (nextRetryAt null) belong to the cohort executor, so this DELIBERATELY drops the prior-art
    // "OR nextRetryAt null" leg (avoids a double-send race with the daily cohort cron). lte excludes
    // nulls in SQL, so it is the explicit-reschedule filter. createdAt floor is the MAX_AGE stale guard.
    const minCreatedAt = new Date(now.getTime() - ROBIN_RECOVERY_RETRY_MAX_AGE_MS);
    return this.prisma.robinRecoverySend.findMany({
      where: {
        status: "pending",
        nextRetryAt: { lte: now },
        attempts: { lt: ROBIN_RECOVERY_MAX_SEND_ATTEMPTS },
        createdAt: { gte: minCreatedAt },
      },
      orderBy: { nextRetryAt: "asc" },
      take: limit,
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        bookingId: true,
        campaignKind: true,
        attempts: true,
      },
    });
  }

  async markSendInFlight(id: string): Promise<void> {
    // Pre-send claim: clear nextRetryAt so findDue (which keys on a due nextRetryAt) cannot re-select
    // this row once an attempt begins. A failed markSent AFTER a successful send then leaves the row
    // non-due rather than re-queued, so the patient is never messaged twice. Status stays "pending";
    // a row stranded here (sent, bookkeeping failed) ages out of findDue and awaits the not-yet-built
    // stalled-pending reaper (backlog A8b/P2-13) for active reconciliation.
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: { nextRetryAt: null },
    });
  }

  async markSent(id: string, messageId: string | null): Promise<void> {
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: { status: "sent", sentAt: new Date(), messageId },
    });
  }

  async markSkipped(id: string, reason: string): Promise<void> {
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: { status: "skipped", skipReason: reason },
    });
  }

  async markFailed(id: string, error: string, nextRetryAt: Date | null): Promise<void> {
    // When nextRetryAt is non-null: re-queue for a retry (status stays pending, attempt count increments).
    // When nextRetryAt is null: dead-letter the row (terminal failed, nextRetryAt cleared explicitly).
    // route-governance: store-mutation-deferred. Single-row id-scoped update on our own freshly
    // minted uuid; org-scoping tracked for #643 (the org-scoped leg is the contact read at dispatch).
    await this.prisma.robinRecoverySend.update({
      where: { id },
      data: nextRetryAt
        ? { status: "pending", attempts: { increment: 1 }, nextRetryAt, lastError: error }
        : { status: "failed", attempts: { increment: 1 }, nextRetryAt: null, lastError: error },
    });
  }
}
