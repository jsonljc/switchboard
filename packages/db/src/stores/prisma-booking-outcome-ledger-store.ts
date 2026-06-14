import type { PrismaClient } from "@prisma/client";

/**
 * One Alex booking outcome joined to its trace and revenue: the per-action
 * outcome ledger the cockpit and Riley attribution join on to render "Alex
 * converted this lead, here is the trace and the revenue" (audit F5).
 *
 * Booking outcomes are produced only by Alex's `calendar-book` tool, so
 * `skillSlug` is the agent attribution (no fabricated agentRole field). The
 * revenue leg is left-joined: it is null until the async `booked` ConversionRecord
 * settles.
 */
export interface BookingOutcomeLedgerRow {
  traceId: string;
  deploymentId: string;
  skillSlug: string;
  outcome: "booked";
  bookingId: string;
  contactId: string;
  service: string;
  bookingStatus: string;
  bookedAt: Date;
  value: number | null;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  occurredAt: Date | null;
}

export class PrismaBookingOutcomeLedgerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listForOrg(args: { orgId: string; limit: number }): Promise<BookingOutcomeLedgerRow[]> {
    const traces = await this.prisma.executionTrace.findMany({
      where: { organizationId: args.orgId, linkedOutcomeType: "booking" },
      orderBy: { createdAt: "desc" },
      take: args.limit,
      select: { id: true, deploymentId: true, skillSlug: true, linkedOutcomeId: true },
    });

    const bookingIds = traces
      .map((t) => t.linkedOutcomeId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (bookingIds.length === 0) return [];

    const [bookings, conversions] = await Promise.all([
      this.prisma.booking.findMany({
        where: { organizationId: args.orgId, id: { in: bookingIds } },
        select: { id: true, contactId: true, service: true, status: true, startsAt: true },
      }),
      this.prisma.conversionRecord.findMany({
        where: { organizationId: args.orgId, bookingId: { in: bookingIds }, type: "booked" },
        select: {
          bookingId: true,
          value: true,
          sourceCampaignId: true,
          sourceAdId: true,
          occurredAt: true,
        },
      }),
    ]);

    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const conversionByBookingId = new Map(
      conversions
        .filter((c): c is typeof c & { bookingId: string } => typeof c.bookingId === "string")
        .map((c) => [c.bookingId, c]),
    );

    const rows: BookingOutcomeLedgerRow[] = [];
    for (const t of traces) {
      const bookingId = t.linkedOutcomeId;
      if (!bookingId) continue;
      const booking = bookingById.get(bookingId);
      if (!booking) continue; // booking absent in this org — skip (honest)
      const conv = conversionByBookingId.get(bookingId) ?? null;
      rows.push({
        traceId: t.id,
        deploymentId: t.deploymentId,
        skillSlug: t.skillSlug,
        outcome: "booked",
        bookingId,
        contactId: booking.contactId,
        service: booking.service,
        bookingStatus: booking.status,
        bookedAt: booking.startsAt,
        value: conv?.value ?? null,
        sourceCampaignId: conv?.sourceCampaignId ?? null,
        sourceAdId: conv?.sourceAdId ?? null,
        occurredAt: conv?.occurredAt ?? null,
      });
    }
    return rows;
  }
}
