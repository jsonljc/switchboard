import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCrmFunnelStore } from "../crm-funnel-store.js";

function makePrisma() {
  return {
    contact: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn(), count: vi.fn() },
    booking: { findMany: vi.fn(), count: vi.fn() },
    lifecycleRevenueEvent: { findMany: vi.fn(), count: vi.fn() },
  };
}

describe("PrismaCrmFunnelStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaCrmFunnelStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaCrmFunnelStore(prisma as never);
  });

  it("returns no rows when campaignIds is empty", async () => {
    const rows = await store.queryFunnelCounts({
      orgId: "o1",
      campaignIds: [],
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    expect(rows).toEqual([]);
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("aggregates per-source funnel counts across stages", async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: "c1", sourceType: "ctwa", attribution: { sourceCampaignId: "camp1" } },
      { id: "c2", sourceType: "ctwa", attribution: { sourceCampaignId: "camp1" } },
      { id: "c3", sourceType: "instant_form", attribution: { sourceCampaignId: "camp1" } },
      { id: "c4", sourceType: "ctwa", attribution: { sourceCampaignId: "other" } },
      { id: "c5", sourceType: "ctwa", attribution: null },
    ]);
    prisma.opportunity.findMany.mockResolvedValue([
      { contactId: "c1" },
      { contactId: "c1" }, // duplicate — should not double-count contact
      { contactId: "c3" },
    ]);
    prisma.booking.findMany.mockResolvedValue([{ contactId: "c1" }]);
    prisma.lifecycleRevenueEvent.findMany.mockResolvedValue([
      { contactId: "c1", amount: 1200 },
      { contactId: "c1", amount: 300 },
    ]);

    const rows = await store.queryFunnelCounts({
      orgId: "o1",
      campaignIds: ["camp1"],
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });

    const find = (sourceType: string, stage: string) =>
      rows.find((r) => r.sourceType === sourceType && r.stage === stage);

    expect(find("ctwa", "lead")?.count).toBe(2);
    expect(find("instant_form", "lead")?.count).toBe(1);
    expect(find("ctwa", "qualified")?.count).toBe(1);
    expect(find("instant_form", "qualified")?.count).toBe(1);
    expect(find("ctwa", "booked")?.count).toBe(1);
    expect(find("ctwa", "paid")?.count).toBe(1);
    expect(find("ctwa", "paid")?.revenue).toBe(1500);
  });

  it("returns conservative defaults for historical means when no leads", async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    const means = await store.queryHistoricalMeans({ orgId: "o1" });
    expect(means.leadToQualified).toBe(0.3);
    expect(means.qualifiedToBooked).toBe(0.4);
    expect(means.bookedToPaid).toBe(0.5);
  });

  it("computes historical means from cumulative counts", async () => {
    prisma.contact.findMany.mockResolvedValue([
      { id: "c1" },
      { id: "c2" },
      { id: "c3" },
      { id: "c4" },
    ]);
    prisma.opportunity.count.mockResolvedValue(2);
    prisma.booking.count.mockResolvedValue(1);
    prisma.lifecycleRevenueEvent.count.mockResolvedValue(1);

    const means = await store.queryHistoricalMeans({ orgId: "o1" });
    expect(means.leadToQualified).toBe(0.5); // 2/4
    expect(means.qualifiedToBooked).toBe(0.5); // 1/2
    expect(means.bookedToPaid).toBe(1); // 1/1
  });
});
