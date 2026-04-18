import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversionRecordStore } from "../prisma-conversion-record-store.js";

function makePrisma() {
  return {
    conversionRecord: {
      upsert: vi.fn(),
      groupBy: vi.fn(),
    },
  };
}

describe("PrismaConversionRecordStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaConversionRecordStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaConversionRecordStore(prisma as never);
  });

  it("records a conversion event idempotently via upsert", async () => {
    (prisma.conversionRecord.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cr_1" });

    await store.record({
      eventId: "evt_1",
      type: "booked",
      contactId: "ct_1",
      organizationId: "org_1",
      value: 100,
      occurredAt: new Date("2026-04-20T10:00:00Z"),
      source: "calendar-book",
      metadata: {},
    });

    expect(prisma.conversionRecord.upsert).toHaveBeenCalledWith({
      where: { eventId: "evt_1" },
      create: expect.objectContaining({ eventId: "evt_1", type: "booked", value: 100 }),
      update: {},
    });
  });

  it("funnelByOrg aggregates counts by stage type", async () => {
    (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { type: "inquiry", _count: { _all: 10 }, _sum: { value: 0 } },
      { type: "qualified", _count: { _all: 7 }, _sum: { value: 0 } },
      { type: "booked", _count: { _all: 3 }, _sum: { value: 300 } },
    ]);

    const dateRange = { from: new Date("2026-04-01"), to: new Date("2026-04-30") };
    const funnel = await store.funnelByOrg("org_1", dateRange);

    expect(funnel.inquiry).toBe(10);
    expect(funnel.qualified).toBe(7);
    expect(funnel.booked).toBe(3);
    expect(funnel.totalRevenue).toBe(300);
    expect(funnel.purchased).toBe(0);
  });
});
