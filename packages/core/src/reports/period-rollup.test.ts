import { describe, it, expect } from "vitest";
import { createPeriodRollup, type ReportDependencies } from "./period-rollup.js";
import { createInMemoryReportCacheStore, createInMemoryBaselineStore } from "./in-memory-store.js";
import type { ReportStores } from "./interfaces.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";

function stubStores(): ReportStores {
  return {
    revenue: {
      sumByOrg: async () => ({ totalAmount: 5000, count: 3 }),
      revenueWithFirstTouch: async () => [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "c-1",
          firstTouchSourceChannel: null,
        },
      ],
      revenueByCampaign: async () => [],
    },
    bookings: {
      countExcludingStatuses: async () => 10,
    },
    opportunities: {
      countClosedWon: async () => 3,
    },
    conversions: {
      countByType: async () => 50,
      leadsBySource: async () => [
        { sourceAdId: "ad-1", sourceCampaignId: "c-1", sourceChannel: null },
      ],
    },
    recommendations: {
      latestByAgent: async () => null,
    },
    orgConfig: {
      getStripePriceId: async () => null,
    },
    conversations: {
      threadCountsByAgent: async () => [],
    },
    deployment: {
      getAlexSlug: async () => null,
    },
  };
}

function stubProvider(): ReportInsightsProvider {
  return {
    getAggregateMetrics: async () => ({
      impressions: 1000,
      inlineLinkClicks: 200,
      landingPageViews: 150,
      spend: 500,
    }),
    getCampaignMetrics: async () => [],
  };
}

function makeDeps(overrides?: Partial<ReportDependencies>): ReportDependencies {
  return {
    stores: stubStores(),
    insightsProvider: stubProvider(),
    reportCache: createInMemoryReportCacheStore(),
    baselineStore: createInMemoryBaselineStore(),
    planMonthlyUSD: 299,
    ...overrides,
  };
}

describe("createPeriodRollup", () => {
  it("returns a complete ReportDataV1 with all required fields", async () => {
    const rollup = createPeriodRollup(makeDeps());

    const result = await rollup({
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
    });

    expect(result.label).toBe("THIS MONTH");
    expect(result.funnel).toHaveLength(6);
    expect(result.attribution.total).toBe(5000);
    expect(result.cost.paid).toBeGreaterThan(0);
    expect(result.campaigns).toBeDefined();
    expect(result.managedComparison).toBeDefined();
    expect(result.pullquote).toBeDefined();
  });

  it("throws when current.window is null", async () => {
    const rollup = createPeriodRollup(makeDeps());

    await expect(
      rollup({
        orgId: "org-1",
        current: {
          start: new Date("2026-04-01T00:00:00Z"),
          end: new Date("2026-05-01T00:00:00Z"),
          window: null,
        },
        prior: {
          start: new Date("2026-03-01T00:00:00Z"),
          end: new Date("2026-04-01T00:00:00Z"),
          window: null,
        },
        computedAt: new Date("2026-04-15T00:00:00Z"),
      }),
    ).rejects.toThrow("current report window is required");
  });

  it("handles null insights provider gracefully", async () => {
    const rollup = createPeriodRollup(makeDeps({ insightsProvider: null }));

    const result = await rollup({
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
    });

    expect(result.funnel[0]?.n).toBe(0);
    expect(result.funnel[3]?.n).toBe(50);
  });
});
