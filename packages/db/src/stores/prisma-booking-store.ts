import type { PrismaClient } from "@prisma/client";
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
// audit-chain ledger lock (900_001). Two-int pg_advisory_xact_lock form.
const BOOKING_LOCK_NS = 920_001;

export class PrismaBookingStore {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateBookingInput) {
    // Serialize check-then-insert per org so two concurrent leads cannot both pass the
    // overlap check and double-book the same physical slot (T2.7). Advisory lock is held
    // until commit; half-open interval test mirrors the Local provider guard but on the
    // LIVE write path.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${input.organizationId}))`;
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

  async findById(bookingId: string) {
    return this.prisma.booking.findUnique({ where: { id: bookingId } });
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_NS}, hashtext(${orgId}))`;
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
    const result = await this.prisma.booking.updateMany({
      where: { id: bookingId, organizationId: orgId },
      data: { status: "cancelled" },
    });
    if (result.count === 0) throw new StaleVersionError(bookingId, -1, -1);
    return this.prisma.booking.findFirstOrThrow({
      where: { id: bookingId, organizationId: orgId },
    });
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
}
