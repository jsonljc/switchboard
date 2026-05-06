import { describe, it, expect } from "vitest";
import { computeManagedComparison } from "./managed-comparison-rollup.js";
import { createInMemoryBaselineStore } from "./in-memory-store.js";
import type { RollupContext } from "./types.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";
import type { ReportStores } from "./interfaces.js";

const ctx: RollupContext = {
  orgId: "org-1",
  current: { start: new Date("2026-04-01"), end: new Date("2026-05-01"), window: "THIS MONTH" },
  prior: { start: new Date("2026-03-01"), end: new Date("2026-04-01"), window: null },
  computedAt: new Date("2026-04-30"),
};

function stubProvider(spend = 1000): ReportInsightsProvider {
  return {
    getAggregateMetrics: async () => ({
      impressions: 50000,
      inlineLinkClicks: 600,
      landingPageViews: 500,
      spend,
    }),
    getCampaignMetrics: async () => [],
  };
}

function stubStores(overrides?: {
  threadCounts?: Array<{ assignedAgent: string; count: number }>;
  alexSlug?: string | null;
  revenueTotal?: number;
}): Pick<ReportStores, "conversations" | "deployment" | "revenue"> {
  return {
    conversations: { threadCountsByAgent: async () => overrides?.threadCounts ?? [] },
    deployment: { getAlexSlug: async () => overrides?.alexSlug ?? null },
    revenue: {
      sumByOrg: async () => ({ totalAmount: overrides?.revenueTotal ?? 0, count: 0 }),
      revenueWithFirstTouch: async () => [],
      revenueByCampaign: async () => [],
    },
  };
}

describe("computeManagedComparison", () => {
  it("returns ads comparison when baseline exists", async () => {
    const baseline = createInMemoryBaselineStore();
    await baseline.insertMany([
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "spend",
        value: 800,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "impressions",
        value: 40000,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "inlineLinkClicks",
        value: 500,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
    ]);
    const result = await computeManagedComparison(ctx, stubProvider(1000), baseline, stubStores());
    expect(result).not.toBeNull();
    expect(result!.source).toBe("pre-switchboard-baseline");
    expect(result!.ads).not.toBeNull();
    expect(result!.ads!.managed.spend).toBe(1000);
    expect(result!.ads!.unmanaged.spend).toBe(800);
  });

  it("triggers lazy-pull and returns ads=null when no baseline", async () => {
    const baseline = createInMemoryBaselineStore();
    const result = await computeManagedComparison(ctx, stubProvider(1000), baseline, stubStores());
    expect(result).toBeNull();
  });

  it("returns null when no provider", async () => {
    const baseline = createInMemoryBaselineStore();
    const result = await computeManagedComparison(ctx, null, baseline, stubStores());
    expect(result).toBeNull();
  });

  it("returns conversations comparison when both cohorts exist", async () => {
    const baseline = createInMemoryBaselineStore();
    await baseline.insertMany([
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "spend",
        value: 800,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
    ]);
    const stores = stubStores({
      alexSlug: "alex",
      threadCounts: [
        { assignedAgent: "alex", count: 30 },
        { assignedAgent: "employee-a", count: 10 },
        { assignedAgent: "", count: 5 },
      ],
    });
    const result = await computeManagedComparison(ctx, stubProvider(), baseline, stores);
    expect(result).not.toBeNull();
    expect(result!.conversations).not.toBeNull();
    expect(result!.conversations!.managed.replies).toBe(30);
    expect(result!.conversations!.unmanaged.replies).toBe(15);
  });

  it("returns conversations=null when no Alex threads", async () => {
    const baseline = createInMemoryBaselineStore();
    await baseline.insertMany([
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "spend",
        value: 800,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
    ]);
    const stores = stubStores({
      alexSlug: "alex",
      threadCounts: [{ assignedAgent: "employee-a", count: 10 }],
    });
    const result = await computeManagedComparison(ctx, stubProvider(), baseline, stores);
    expect(result).not.toBeNull();
    expect(result!.conversations).toBeNull();
  });

  it("returns null when both dimensions are null", async () => {
    const baseline = createInMemoryBaselineStore();
    const result = await computeManagedComparison(ctx, stubProvider(), baseline, stubStores());
    expect(result).toBeNull();
  });
});
