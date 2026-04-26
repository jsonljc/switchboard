import { describe, it, expect, vi } from "vitest";
import { RealCrmDataProvider } from "./real-provider.js";

const makeStore = (
  rows: Array<{
    sourceType: string;
    sourceCampaignId: string;
    stage: string;
    revenue?: number;
    count: number;
  }>,
) => ({
  queryFunnelCounts: vi.fn().mockResolvedValue(rows),
  queryHistoricalMeans: vi.fn().mockResolvedValue({
    leadToQualified: 0.5,
    qualifiedToBooked: 0.6,
    bookedToPaid: 0.7,
  }),
});

describe("RealCrmDataProvider", () => {
  it("aggregates per-source funnel from raw counts", async () => {
    const store = makeStore([
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "lead", count: 100 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "qualified", count: 30 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "booked", count: 12 },
      { sourceType: "instant_form", sourceCampaignId: "c1", stage: "lead", count: 200 },
      { sourceType: "instant_form", sourceCampaignId: "c1", stage: "qualified", count: 8 },
    ]);
    const provider = new RealCrmDataProvider(store);
    const data = await provider.getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c1"],
      startDate: "2026-04-19",
      endDate: "2026-04-26",
    });
    expect(data.bySource.ctwa!.received).toBe(100);
    expect(data.bySource.ctwa!.qualified).toBe(30);
    expect(data.bySource.ctwa!.booked).toBe(12);
    expect(data.bySource.instant_form!.received).toBe(200);
  });

  it("returns benchmarks computed from real historical means", async () => {
    const provider = new RealCrmDataProvider(makeStore([]));
    const b = await provider.getBenchmarks({ orgId: "o1", accountId: "a1" });
    // Spec field names
    expect(b.leadToQualified).toBe(0.5);
    expect(b.qualifiedToBooked).toBe(0.6);
    expect(b.bookedToPaid).toBe(0.7);
    // Legacy *Rate field names mirror the spec fields
    expect(b.leadToQualifiedRate).toBe(0.5);
    expect(b.qualifiedToBookingRate).toBe(0.6);
    expect(b.bookingToClosedRate).toBe(0.7);
    expect(b.leadToClosedRate).toBeCloseTo(0.5 * 0.6 * 0.7);
  });

  it("returns null benchmarks when no historical data exists", async () => {
    const store = {
      queryFunnelCounts: vi.fn().mockResolvedValue([]),
      queryHistoricalMeans: vi.fn().mockResolvedValue({
        leadToQualified: null,
        qualifiedToBooked: null,
        bookedToPaid: null,
      }),
    };
    const provider = new RealCrmDataProvider(store);
    const b = await provider.getBenchmarks({ orgId: "o1", accountId: "a1" });
    expect(b.leadToQualified).toBeNull();
    expect(b.qualifiedToBooked).toBeNull();
    expect(b.bookedToPaid).toBeNull();
    expect(b.leadToQualifiedRate).toBeNull();
    expect(b.qualifiedToBookingRate).toBeNull();
    expect(b.bookingToClosedRate).toBeNull();
    expect(b.leadToClosedRate).toBeNull();
  });

  it("preserves CrmFunnelData aggregate fields for backward compatibility", async () => {
    const store = makeStore([
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "lead", count: 100 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "qualified", count: 30 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "paid", count: 5, revenue: 1500 },
      { sourceType: "instant_form", sourceCampaignId: "c1", stage: "lead", count: 50 },
    ]);
    const provider = new RealCrmDataProvider(store);
    const data = await provider.getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c1"],
      startDate: new Date("2026-04-19"),
      endDate: new Date("2026-04-26"),
    });
    expect(data.leads).toBe(150);
    expect(data.qualified).toBe(30);
    expect(data.closed).toBe(5);
    expect(data.revenue).toBe(1500);
    expect(data.rates.leadToQualified).toBeCloseTo(30 / 150);
    expect(data.coverage.attributedContacts).toBe(150);
  });

  it("ignores rows with unknown source types", async () => {
    const store = makeStore([
      { sourceType: "organic", sourceCampaignId: "c1", stage: "lead", count: 999 },
    ]);
    const provider = new RealCrmDataProvider(store);
    const data = await provider.getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c1"],
      startDate: "2026-04-19",
      endDate: "2026-04-26",
    });
    expect(data.bySource.ctwa!.received).toBe(0);
    expect(data.bySource.instant_form!.received).toBe(0);
    expect(data.leads).toBe(0);
  });
});
