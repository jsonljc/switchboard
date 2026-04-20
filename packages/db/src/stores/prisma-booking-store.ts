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

  async confirm(bookingId: string, calendarEventId: string) {
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: "confirmed", calendarEventId },
    });
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

  async markFailed(bookingId: string) {
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: "failed" },
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

    return this.prisma.booking.findMany({
      where: {
        organizationId: orgId,
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: ["cancelled", "failed"] },
      },
      orderBy: { startsAt: "asc" },
      take: limit,
      include: {
        contact: { select: { name: true } },
      },
    });
  }
}
