import { StaleVersionError } from "@switchboard/core";
import type { PrismaDbClient } from "../prisma-db.js";

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

export class PrismaBookingStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateBookingInput) {
    return this.prisma.booking.create({
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
