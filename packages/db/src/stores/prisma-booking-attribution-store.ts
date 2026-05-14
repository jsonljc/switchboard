import type { PrismaDbClient } from "../prisma-db.js";
import type { BookingAttributionStore } from "@switchboard/core";

/**
 * Prisma-backed implementation of `BookingAttributionStore` (Task 20).
 *
 * Both queries order by `createdAt ASC` to satisfy the contract documented on
 * `BookingAttributionStore`: the resolver picks the first row deterministically,
 * so we must not depend on the DB query plan.
 */
export class PrismaBookingAttributionStore implements BookingAttributionStore {
  constructor(private prisma: PrismaDbClient) {}

  async findByWorkTraceIds(
    organizationId: string,
    workTraceIds: string[],
  ): Promise<Array<{ id: string; workTraceId: string | null }>> {
    if (workTraceIds.length === 0) return [];
    return this.prisma.booking.findMany({
      where: { organizationId, workTraceId: { in: workTraceIds } },
      select: { id: true, workTraceId: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async findInWindow(
    organizationId: string,
    contactId: string,
    startExclusive: Date,
    endInclusive: Date,
  ): Promise<Array<{ id: string }>> {
    return this.prisma.booking.findMany({
      where: {
        organizationId,
        contactId,
        createdAt: { gt: startExclusive, lte: endInclusive },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
  }
}
