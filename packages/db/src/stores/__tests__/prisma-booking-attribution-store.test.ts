import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaBookingAttributionStore } from "../prisma-booking-attribution-store.js";

function makePrisma() {
  return {
    booking: {
      findMany: vi.fn(),
    },
  };
}

describe("PrismaBookingAttributionStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBookingAttributionStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBookingAttributionStore(prisma as never);
  });

  describe("findByWorkTraceIds", () => {
    it("queries booking by organizationId and workTraceId IN list, ordered by createdAt asc", async () => {
      const findManyMock = prisma.booking.findMany as ReturnType<typeof vi.fn>;
      findManyMock.mockResolvedValue([{ id: "bk_1", workTraceId: "wt_1" }]);

      const rows = await store.findByWorkTraceIds("org_1", ["wt_1", "wt_2"]);

      expect(findManyMock).toHaveBeenCalledWith({
        where: { organizationId: "org_1", workTraceId: { in: ["wt_1", "wt_2"] } },
        select: { id: true, workTraceId: true },
        orderBy: { createdAt: "asc" },
      });
      expect(rows).toEqual([{ id: "bk_1", workTraceId: "wt_1" }]);
    });

    it("returns [] without calling the DB when workTraceIds is empty", async () => {
      const findManyMock = prisma.booking.findMany as ReturnType<typeof vi.fn>;

      const rows = await store.findByWorkTraceIds("org_1", []);

      expect(rows).toEqual([]);
      expect(findManyMock).not.toHaveBeenCalled();
    });
  });

  describe("findInWindow", () => {
    it("queries booking with createdAt > startExclusive AND <= endInclusive, ordered by createdAt asc", async () => {
      const findManyMock = prisma.booking.findMany as ReturnType<typeof vi.fn>;
      findManyMock.mockResolvedValue([{ id: "bk_2" }]);

      const start = new Date("2026-05-14T10:00:00Z");
      const end = new Date("2026-05-15T10:00:00Z");
      const rows = await store.findInWindow("org_1", "ct_1", start, end);

      expect(findManyMock).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          contactId: "ct_1",
          createdAt: { gt: start, lte: end },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      expect(rows).toEqual([{ id: "bk_2" }]);
    });
  });
});
