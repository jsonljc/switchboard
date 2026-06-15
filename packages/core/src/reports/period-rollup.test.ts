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
      countMaturedAttendance: async () => ({ matured: 0, attended: 0 }),
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
    contacts: {
      countConsentCompleteness: async () => ({ bookable: 0, validConsent: 0 }),
    },
    receipts: {
      countReceiptedBookingsInWindow: async () => 41,
    },
    receiptedBookings: {
      listForCohort: async () => [],
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
  const defaultPullQuote: ReportDependencies["pullQuoteGenerator"] = async () => ({
    pre: "Stub pre",
    value: "$0",
    mid: "stub mid",
    cost: "$0",
    post: "stub post.",
  });
  return {
    stores: stubStores(),
    insightsProvider: stubProvider(),
    reportCache: createInMemoryReportCacheStore(),
    baselineStore: createInMemoryBaselineStore(),
    planMonthlyUSD: 299,
    pullQuoteGenerator: defaultPullQuote,
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
    expect(result.receiptedBookings).toEqual({ count: 41 });
    expect(result.receiptedBookingQuality).toEqual({
      cohortSize: 0,
      confidence: { deterministic: 0, high: 0, medium: 0, low: 0, unattributed: 0 },
      exceptions: {
        missing_source: 0,
        missing_consent: 0,
        manual_override: 0,
        duplicate_contact_risk: 0,
      },
      bookingsNeedingAttention: 0,
      worklist: [],
    });
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

  it("invokes pullQuoteGenerator with ctx, attribution, cost, and funnelNarrative; result lands in payload.pullquote", async () => {
    const captured: Array<unknown> = [];
    const sentinel = {
      pre: "sentinel pre",
      value: "$5,000",
      mid: "sentinel mid",
      cost: "$299",
      post: "sentinel post.",
    };
    const pullQuoteGenerator: ReportDependencies["pullQuoteGenerator"] = async (input) => {
      captured.push(input);
      return sentinel;
    };

    const rollup = createPeriodRollup(makeDeps({ pullQuoteGenerator }));

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

    expect(captured).toHaveLength(1);
    const input = captured[0] as {
      ctx: { orgId: string; current: { window: string } };
      attribution: { total: number };
      cost: { paid: number };
      funnelNarrative: { text: string };
    };
    expect(input.ctx.orgId).toBe("org-1");
    expect(input.ctx.current.window).toBe("THIS MONTH");
    expect(input.attribution.total).toBe(5000);
    expect(input.cost.paid).toBeGreaterThan(0);
    expect(input.funnelNarrative).toBeDefined();

    expect(result.pullquote).toEqual(sentinel);
  });
});
