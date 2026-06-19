import { describe, it, expect } from "vitest";
import { computeFunnel } from "./funnel-rollup.js";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";

function makeCtx(): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

function makeProvider(
  current: {
    impressions: number;
    inlineLinkClicks: number;
    landingPageViews: number;
    spend: number;
  },
  prior: { impressions: number; inlineLinkClicks: number; landingPageViews: number; spend: number },
): ReportInsightsProvider {
  return {
    getAggregateMetrics: async (dateRange) => {
      const isCurrent = dateRange.since === "2026-04-01";
      return isCurrent ? current : prior;
    },
    getCampaignMetrics: async () => [],
  };
}

function makeStores(opts: {
  currentLeads?: number;
  priorLeads?: number;
  currentBookings?: number;
  priorBookings?: number;
  currentCustomers?: number;
  priorCustomers?: number;
  narrative?: { date: Date; humanSummary: string } | null;
}): Pick<ReportStores, "conversions" | "bookings" | "opportunities" | "recommendations"> {
  return {
    conversions: {
      countByType: async (_orgId, _type, from) => {
        const isCurrent = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrent ? (opts.currentLeads ?? 0) : (opts.priorLeads ?? 0);
      },
      leadsBySource: async () => [],
    },
    bookings: {
      countExcludingStatuses: async ({ from }) => {
        const isCurrent = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrent ? (opts.currentBookings ?? 0) : (opts.priorBookings ?? 0);
      },
      countMaturedAttendance: async () => ({ matured: 0, attended: 0 }),
      countNoShowsInWindow: async () => 0,
    },
    opportunities: {
      countClosedWon: async ({ from }) => {
        const isCurrent = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrent ? (opts.currentCustomers ?? 0) : (opts.priorCustomers ?? 0);
      },
    },
    recommendations: {
      latestByAgent: async () => opts.narrative ?? null,
    },
  };
}

describe("computeFunnel", () => {
  it("returns 6 stages with correct labels", async () => {
    const provider = makeProvider(
      { impressions: 1000, inlineLinkClicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 800, inlineLinkClicks: 160, landingPageViews: 120, spend: 400 },
    );
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
    });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnel).toHaveLength(6);
    expect(result.funnel.map((r) => r.stage)).toEqual([
      "Impressions",
      "Clicks",
      "Landing page views",
      "Leads",
      "Bookings",
      "Customers",
    ]);
  });

  it("computes correct counts from provider and stores", async () => {
    const provider = makeProvider(
      { impressions: 5000, inlineLinkClicks: 1000, landingPageViews: 800, spend: 2000 },
      { impressions: 0, inlineLinkClicks: 0, landingPageViews: 0, spend: 0 },
    );
    const stores = makeStores({ currentLeads: 100, currentBookings: 25, currentCustomers: 5 });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnel[0]?.n).toBe(5000);
    expect(result.funnel[1]?.n).toBe(1000);
    expect(result.funnel[2]?.n).toBe(800);
    expect(result.funnel[3]?.n).toBe(100);
    expect(result.funnel[4]?.n).toBe(25);
    expect(result.funnel[5]?.n).toBe(5);
  });

  it("renders top 3 rows as zero with null delta when provider is null", async () => {
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
    });

    const result = await computeFunnel(makeCtx(), stores, null);

    expect(result.funnel[0]?.n).toBe(0);
    expect(result.funnel[0]?.delta).toBeNull();
    expect(result.funnel[1]?.n).toBe(0);
    expect(result.funnel[2]?.n).toBe(0);
    expect(result.funnel[3]?.n).toBe(50);
    expect(result.funnel[3]?.delta).not.toBeNull();
  });

  it("returns null delta when prior is zero", async () => {
    const provider = makeProvider(
      { impressions: 1000, inlineLinkClicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 0, inlineLinkClicks: 0, landingPageViews: 0, spend: 0 },
    );
    const stores = makeStores({ currentLeads: 50, currentBookings: 10, currentCustomers: 3 });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnel[0]?.delta).toBeNull();
  });

  it("uses Riley narrative from recommendations when available", async () => {
    const provider = makeProvider(
      { impressions: 1000, inlineLinkClicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 800, inlineLinkClicks: 160, landingPageViews: 120, spend: 400 },
    );
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
      narrative: {
        date: new Date("2026-04-10T00:00:00Z"),
        humanSummary: "Fatigued creatives reducing engagement",
      },
    });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnelNarrative.marker).toBe("Riley");
    expect(result.funnelNarrative.text).toContain("Fatigued creatives");
  });

  it("falls back to static narrative when no recommendation exists", async () => {
    const provider = makeProvider(
      { impressions: 1000, inlineLinkClicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 800, inlineLinkClicks: 160, landingPageViews: 120, spend: 400 },
    );
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
    });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnelNarrative.marker).toBe("Riley");
    expect(result.funnelNarrative.text).toContain("No analysis available");
  });
});
