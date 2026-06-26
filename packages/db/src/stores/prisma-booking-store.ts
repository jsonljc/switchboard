import type { PrismaClient, Prisma } from "@prisma/client";
import { StaleVersionError } from "@switchboard/core";
import { BookingSlotConflictError } from "@switchboard/schemas";

interface CreateBookingInput {
  organizationId: string;
  contactId: string;
  opportunityId?: string | null;
  service: string;
  startsAt: Date;
  endsAt: Date;
  timezone?: string;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  connectionId?: string | null;
  createdByType?: string;
  sourceChannel?: string | null;
  workTraceId?: string | null;
}

// Advisory-lock namespace for per-org booking serialization. Distinct from the
// audit-chain ledger lock (900_001). Internal: callers lock through acquireBookingLock,
// which owns the mandatory ::int4 cast.
const BOOKING_LOCK_NS = 920_001;

/**
 * Acquire the per-org booking advisory lock inside an OPEN transaction, serializing
 * check-then-insert/update so two concurrent bookings for one org cannot both pass the
 * overlap check and double-book a slot. Held until the transaction commits.
 *
 * The `::int4` cast is mandatory, and the reason this is a single shared helper: Prisma
 * sends JS numbers as bigint, and the two-key signature `pg_advisory_xact_lock(bigint,
 * integer)` does not exist (Postgres error 42883). Every durable booking write path
 * (PrismaBookingStore.create / reschedule) locks through here so no call site can reintroduce
 * that bug or drift from this namespace (F12).
 */
export async function acquireBookingLock(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}::int4, hashtext(${organizationId}))`;
}

export class PrismaBookingStore {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateBookingInput) {
    // Serialize check-then-insert per org so two concurrent leads cannot both pass the
    // overlap check and double-book the same physical slot (T2.7). Advisory lock is held
    // until commit; half-open interval test mirrors the Local provider guard but on the
    // LIVE write path.
    return this.prisma.$transaction(async (tx) => {
      await acquireBookingLock(tx, input.organizationId);
      // Single-resource-per-org capacity assumption: overlap is org-wide (not per
      // calendarId/room/practitioner), mirroring the original Local-provider guard.
      const overlap = await tx.booking.findFirst({
        where: {
          organizationId: input.organizationId,
          status: { notIn: ["failed", "cancelled"] },
          startsAt: { lt: input.endsAt },
          endsAt: { gt: input.startsAt },
        },
        select: { id: true },
      });
      if (overlap) throw new BookingSlotConflictError(overlap.id);
      return tx.booking.create({
        data: {
          organizationId: input.organizationId,
          contactId: input.contactId,
          opportunityId: input.opportunityId ?? null,
          service: input.service,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: input.timezone ?? "Asia/Singapore",
          status: "pending_confirmation",
          attendeeName: input.attendeeName ?? null,
          attendeeEmail: input.attendeeEmail ?? null,
          connectionId: input.connectionId ?? null,
          createdByType: input.createdByType ?? "agent",
          sourceChannel: input.sourceChannel ?? null,
          workTraceId: input.workTraceId ?? null,
        },
      });
    });
  }

  async confirm(organizationId: string, bookingId: string, calendarEventId: string) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId },
      data: { status: "confirmed", calendarEventId },
    });
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId } });
  }

  async findById(organizationId: string, bookingId: string) {
    return this.prisma.booking.findFirst({ where: { id: bookingId, organizationId } });
  }

  async countConfirmed(orgId: string) {
    return this.prisma.booking.count({
      where: { organizationId: orgId, status: "confirmed" },
    });
  }

  async findBySlot(orgId: string, contactId: string, service: string, startsAt: Date) {
    return this.prisma.booking.findFirst({
      where: { organizationId: orgId, contactId, service, startsAt },
    });
  }

  async markFailed(organizationId: string, bookingId: string) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId },
      data: { status: "failed" },
    });
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId } });
  }

  async findUpcomingByContact(orgId: string, contactId: string, now: Date = new Date()) {
    return this.prisma.booking.findMany({
      where: {
        organizationId: orgId,
        contactId,
        status: { notIn: ["cancelled", "failed"] },
        startsAt: { gte: now },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        calendarEventId: true,
        service: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    });
  }

  async reschedule(orgId: string, bookingId: string, slot: { startsAt: Date; endsAt: Date }) {
    // Serialize check-then-move per org (mirrors create()) so a reschedule cannot
    // land on a slot another LIVE booking already holds. Advisory lock held until
    // commit; overlap is half-open and excludes the booking being moved.
    return this.prisma.$transaction(async (tx) => {
      await acquireBookingLock(tx, orgId);
      // Single-resource-per-org capacity assumption: overlap is org-wide (not per
      // calendarId/room/practitioner), mirroring the original Local-provider guard.
      // Exclude the booking being moved so a no-op/shrink reschedule doesn't self-conflict.
      const overlap = await tx.booking.findFirst({
        where: {
          organizationId: orgId,
          id: { not: bookingId },
          status: { notIn: ["failed", "cancelled"] },
          startsAt: { lt: slot.endsAt },
          endsAt: { gt: slot.startsAt },
        },
        select: { id: true },
      });
      if (overlap) throw new BookingSlotConflictError(overlap.id);
      const result = await tx.booking.updateMany({
        where: { id: bookingId, organizationId: orgId },
        data: {
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          rescheduleCount: { increment: 1 },
          rescheduledAt: new Date(),
        },
      });
      if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
      return tx.booking.findFirstOrThrow({ where: { id: bookingId, organizationId: orgId } });
    });
  }

  async cancel(orgId: string, bookingId: string) {
    // P2-18 proof-chain retraction: a cancelled booking did not happen, so its proof artifacts
    // must stop counting toward the receipted cohort / proven-paid revenue. Flip the canonical
    // booking AND retract its receipts AND reverse its confirmed deposit revenue in ONE
    // transaction. The booking flip runs FIRST so a missing / cross-org id fails closed
    // (count === 0) BEFORE any cascade. Both cascade writes filter on current state, so a
    // double-cancel matches 0 rows and is a safe no-op. Every leg is org + booking scoped.
    // Scope: this governs the owner-report proof chain (receipts + revenue events). The already
    // emitted `purchased` outbox / ad-attribution conversion is NOT reversed here (a separate
    // CAPI-reversal concern).
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.updateMany({
        where: { id: bookingId, organizationId: orgId },
        data: { status: "cancelled" },
      });
      if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);

      // Receipts -> void (calendar + payment). The read side already excludes status "void"
      // (is-paid-visit.ts, and the booked|held cohort/count filters), so this is the missing
      // writer, not a read change.
      await tx.receipt.updateMany({
        where: { organizationId: orgId, bookingId, status: { not: "void" } },
        data: { status: "void" },
      });

      // Confirmed deposit revenue -> refunded + unverified. "refunded" is the model's existing
      // reversal status (the schema default-lifecycle anticipates pending -> confirmed ->
      // refunded); verified:false drops it from paidVisitsByCampaign (which filters verified, not
      // status). We transition, never delete (append-only money trail); no partial-refund netting.
      await tx.lifecycleRevenueEvent.updateMany({
        where: { organizationId: orgId, bookingId, status: "confirmed" },
        data: { status: "refunded", verified: false },
      });

      return tx.booking.findFirstOrThrow({ where: { id: bookingId, organizationId: orgId } });
    });
  }

  async recordAttendance(organizationId: string, bookingId: string, outcome: string) {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId },
      data: { attendance: outcome },
    });
    // count === 0 => no booking for this org. updateMany swallows the no-row case,
    // so guard it (else a wrong/cross-org id reports phantom success).
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({ where: { id: bookingId, organizationId } });
  }

  async listByDate(
    orgId: string,
    date: Date,
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      startsAt: Date;
      service: string;
      status: string;
      sourceChannel: string | null;
      contact: { name: string | null };
    }>
  > {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const rows = await this.prisma.booking.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: ["cancelled", "failed"] },
      },
      orderBy: { startsAt: "asc" },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      startsAt: r.startsAt,
      service: r.service,
      status: r.status,
      sourceChannel: r.sourceChannel,
      contact: { name: r.attendeeName },
    }));
  }

  // Intentionally cross-org: called by the reminder cron (a system-level scan, not an
  // org-scoped request). The cron dispatches reminders for all orgs in a single pass.
  async findUpcomingConfirmed(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<
    Array<{
      id: string;
      organizationId: string;
      contactId: string;
      startsAt: Date;
      timezone: string;
      attendeeName: string | null;
    }>
  > {
    // Bound the cross-org scan (mirrors lifecycle-stalled-sweep's take:1000) so a backlog
    // can't blow up the result set or the per-row Inngest step fan-out in the dispatch cron.
    // A 2h window of confirmed bookings across all pilot orgs is far below this.
    const SCAN_LIMIT = 1000;
    const rows = await this.prisma.booking.findMany({
      where: { status: "confirmed", startsAt: { gte: windowStart, lt: windowEnd } },
      orderBy: { startsAt: "asc" },
      take: SCAN_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      contactId: r.contactId,
      startsAt: r.startsAt,
      timezone: r.timezone,
      attendeeName: r.attendeeName,
    }));
  }

  async countExcludingStatuses(input: {
    orgId: string;
    excludeStatuses: readonly string[];
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.booking.count({
      where: {
        organizationId: input.orgId,
        status: { notIn: [...input.excludeStatuses] },
        createdAt: { gte: input.from, lt: input.to },
      },
    });
  }

  async countMaturedAttendance(input: {
    orgId: string;
    from: Date;
    to: Date;
    now: Date;
  }): Promise<{ matured: number; attended: number }> {
    const where = {
      organizationId: input.orgId,
      status: { notIn: ["cancelled", "failed"] },
      startsAt: { gte: input.from, lt: input.to, lte: input.now },
    };
    const [matured, attended] = await Promise.all([
      this.prisma.booking.count({ where }),
      this.prisma.booking.count({ where: { ...where, attendance: "attended" } }),
    ]);
    return { matured, attended };
  }

  async countNoShowsInWindow(input: { orgId: string; from: Date; to: Date }): Promise<number> {
    return this.prisma.booking.count({
      where: {
        organizationId: input.orgId,
        attendance: "no_show",
        startsAt: { gte: input.from, lt: input.to },
      },
    });
  }

  // Org-scoped list of no-show bookings in a window, the cohort Robin's recovery campaign targets.
  // Runs on the @@index([organizationId, attendance]) (purpose-built for this query) and is bounded
  // like findUpcomingConfirmed so a backlog cannot blow up the cohort. attendeeName is denormalized
  // on Booking (display only); the recipient phone is resolved at send time from contactId, never
  // here. Org-scoped (organizationId in the where) per the F12 / IDOR rule.
  async findNoShowRecoveryCandidates(input: { orgId: string; from: Date; to: Date }): Promise<
    Array<{
      bookingId: string;
      contactId: string;
      service: string;
      startsAt: Date;
      attendeeName: string | null;
    }>
  > {
    const SCAN_LIMIT = 1000;
    const rows = await this.prisma.booking.findMany({
      where: {
        organizationId: input.orgId,
        attendance: "no_show",
        startsAt: { gte: input.from, lt: input.to },
      },
      orderBy: { startsAt: "asc" },
      take: SCAN_LIMIT,
      select: { id: true, contactId: true, service: true, startsAt: true, attendeeName: true },
    });
    return rows.map((r) => ({
      bookingId: r.id,
      contactId: r.contactId,
      service: r.service,
      startsAt: r.startsAt,
      attendeeName: r.attendeeName,
    }));
  }

  // Org-scoped batched read: which of `contactIds` hold an ACTIVE upcoming booking as of `now`?
  // Robin's recovery cron uses this to exclude patients who already self-rebooked (no recovery
  // needed). Mirrors findUpcomingByContact's active-upcoming predicate (status not cancelled/failed,
  // startsAt >= now). Org-scoped per the F12 / IDOR rule; `distinct` keeps the result a contact set.
  async findFutureBookingContactIds(
    orgId: string,
    contactIds: string[],
    now: Date,
  ): Promise<Set<string>> {
    if (contactIds.length === 0) return new Set();
    const rows = await this.prisma.booking.findMany({
      where: {
        organizationId: orgId,
        contactId: { in: contactIds },
        status: { notIn: ["cancelled", "failed"] },
        startsAt: { gte: now },
      },
      select: { contactId: true },
      distinct: ["contactId"],
    });
    return new Set(rows.map((r) => r.contactId));
  }

  // Cross-org system sweep (like findUpcomingConfirmed): the bookings the stalled-pending reaper
  // ages to `failed`. A booking is created `pending_confirmation` BEFORE the external calendar
  // mutation; if the terminalizing write (confirm / markFailed / the failure-handler tx) is lost
  // to a thrown tx or a process death, the row is stranded pending_confirmation and the overlap
  // predicate (notIn [failed, cancelled]) blocks its slot forever. `createdAt` is the age axis: a
  // legitimate pending resolves within one synchronous tool call, so anything older than the
  // reaper TTL is stranded. Bounded (runs on @@index([status]) / @@index([organizationId,
  // createdAt])) so a backlog cannot blow up the scan.
  async findStalledPending(
    olderThan: Date,
    limit: number,
  ): Promise<Array<{ id: string; organizationId: string; createdAt: Date }>> {
    return this.prisma.booking.findMany({
      where: { status: "pending_confirmation", createdAt: { lt: olderThan } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, organizationId: true, createdAt: true },
    });
  }

  // Race-safe compare-and-set: the `status: "pending_confirmation"` predicate is the guard. If a
  // concurrent confirm()/markFailed() moved the row between the reaper's scan and here, count===0
  // (a benign race) and we never overwrite a now-confirmed booking. Org + booking scoped (F12 / IDOR).
  async reapStalledPending(organizationId: string, bookingId: string): Promise<{ count: number }> {
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId, status: "pending_confirmation" },
      data: { status: "failed" },
    });
    return { count: result.count };
  }
}
