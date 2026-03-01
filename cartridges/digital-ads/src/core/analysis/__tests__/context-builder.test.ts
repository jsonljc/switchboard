import { describe, it, expect, vi } from "vitest";
import { buildDiagnosticContext } from "../context-builder.js";
import type { MetricSnapshot, FunnelSchema } from "../../types.js";
import type { PlatformClient } from "../../../platforms/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FUNNEL: FunnelSchema = {
  vertical: "commerce",
  stages: [
    { name: "awareness", metric: "impressions", metricSource: "top_level", costMetric: "cpm", costMetricSource: "top_level" },
    { name: "click", metric: "clicks", metricSource: "top_level", costMetric: "cpc", costMetricSource: "top_level" },
    { name: "purchase", metric: "purchase", metricSource: "actions", costMetric: "cost_per_purchase", costMetricSource: "cost_per_action_type" },
  ],
  primaryKPI: "purchase",
  roasMetric: null,
};

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {
      impressions: { count: 10000, cost: 100 },
      clicks: { count: 500, cost: 2 },
      purchase: { count: 50, cost: 20 },
    },
    topLevel: {
      impressions: 10000,
      clicks: 500,
      spend: 1000,
      ctr: 5,
      cpm: 100,
      conversions_value: 2500,
    },
    ...overrides,
  };
}

function makeMockClient(snapshots: MetricSnapshot[]): PlatformClient {
  let callIndex = 0;
  return {
    platform: "meta",
    fetchSnapshot: vi.fn().mockImplementation(() => {
      return Promise.resolve(snapshots[callIndex++] ?? makeSnapshot());
    }),
    fetchComparisonSnapshots: vi.fn().mockResolvedValue({
      current: makeSnapshot(),
      previous: makeSnapshot(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDiagnosticContext", () => {
  it("returns empty context when no features are enabled", async () => {
    const client = makeMockClient([]);

    const context = await buildDiagnosticContext({
      client,
      entityId: "act_123",
      entityLevel: "account",
      funnel: FUNNEL,
      referenceDate: new Date("2024-01-14"),
      periodDays: 7,
    });

    expect(context).toEqual({});
    expect(client.fetchSnapshot).not.toHaveBeenCalled();
  });

  it("fetches historical snapshots when enabled", async () => {
    const snapshots = [
      makeSnapshot({ periodStart: "2024-01-08", periodEnd: "2024-01-14" }),
      makeSnapshot({ periodStart: "2024-01-01", periodEnd: "2024-01-07" }),
      makeSnapshot({ periodStart: "2023-12-25", periodEnd: "2023-12-31" }),
      makeSnapshot({ periodStart: "2023-12-18", periodEnd: "2023-12-24" }),
    ];
    const client = makeMockClient(snapshots);

    const context = await buildDiagnosticContext({
      client,
      entityId: "act_123",
      entityLevel: "account",
      funnel: FUNNEL,
      referenceDate: new Date("2024-01-14"),
      periodDays: 7,
      enableHistorical: true,
      historicalPeriods: 4,
    });

    expect(context.historicalSnapshots).toHaveLength(4);
    expect(client.fetchSnapshot).toHaveBeenCalledTimes(4);
  });

  it("uses default 4 periods when historicalPeriods not specified", async () => {
    const client = makeMockClient([
      makeSnapshot(),
      makeSnapshot(),
      makeSnapshot(),
      makeSnapshot(),
    ]);

    const context = await buildDiagnosticContext({
      client,
      entityId: "act_123",
      entityLevel: "account",
      funnel: FUNNEL,
      referenceDate: new Date("2024-01-14"),
      periodDays: 7,
      enableHistorical: true,
    });

    expect(context.historicalSnapshots).toHaveLength(4);
  });

  it("extracts revenue data from snapshots", async () => {
    const current = makeSnapshot({
      topLevel: {
        impressions: 10000,
        clicks: 500,
        spend: 1000,
        conversions_value: 2500,
        ctr: 5,
        cpm: 100,
      },
      stages: {
        impressions: { count: 10000, cost: 100 },
        clicks: { count: 500, cost: 2 },
        purchase: { count: 50, cost: 20 },
      },
    });
    const previous = makeSnapshot({
      topLevel: {
        impressions: 12000,
        clicks: 600,
        spend: 1200,
        conversions_value: 3000,
        ctr: 5,
        cpm: 100,
      },
    });

    const client = makeMockClient([]);

    const context = await buildDiagnosticContext({
      client,
      entityId: "act_123",
      entityLevel: "account",
      funnel: FUNNEL,
      referenceDate: new Date("2024-01-14"),
      periodDays: 7,
      currentSnapshot: current,
      previousSnapshot: previous,
    });

    expect(context.revenueData).toBeDefined();
    expect(context.revenueData!.averageOrderValue).toBe(50); // 2500 / 50
    expect(context.revenueData!.totalRevenue).toBe(2500);
    expect(context.revenueData!.previousTotalRevenue).toBe(3000);
  });

  it("returns undefined revenueData when no conversions", async () => {
    const current = makeSnapshot({
      topLevel: { impressions: 10000, clicks: 500, spend: 1000 },
      stages: {
        impressions: { count: 10000, cost: 100 },
        clicks: { count: 500, cost: 2 },
        purchase: { count: 0, cost: null },
      },
    });
    const previous = makeSnapshot();
    const client = makeMockClient([]);

    const context = await buildDiagnosticContext({
      client,
      entityId: "act_123",
      entityLevel: "account",
      funnel: FUNNEL,
      referenceDate: new Date("2024-01-14"),
      periodDays: 7,
      currentSnapshot: current,
      previousSnapshot: previous,
    });

    expect(context.revenueData).toBeUndefined();
  });

  it("fetches sub-entity breakdowns when enableStructural and client supports it", async () => {
    const mockBreakdowns = [
      { entityId: "adset_1", entityLevel: "adset" as const, spend: 500, conversions: 20, daysSinceLastEdit: null, inLearningPhase: false, dailyBudget: null },
      { entityId: "adset_2", entityLevel: "adset" as const, spend: 500, conversions: 30, daysSinceLastEdit: null, inLearningPhase: false, dailyBudget: null },
    ];

    const client = makeMockClient([]);
    (client as any).fetchSubEntityBreakdowns = vi.fn().mockResolvedValue(mockBreakdowns);

    const context = await buildDiagnosticContext({
      client,
      entityId: "act_123",
      entityLevel: "account",
      funnel: FUNNEL,
      referenceDate: new Date("2024-01-14"),
      periodDays: 7,
      enableStructural: true,
    });

    expect(context.subEntities).toHaveLength(2);
    expect((client as any).fetchSubEntityBreakdowns).toHaveBeenCalledTimes(1);
  });
});
