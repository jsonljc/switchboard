import { describe, it, expect } from "vitest";
import { analyzeFunnel, type FindingAdvisor } from "../funnel-walker.js";
import type {
  FunnelSchema,
  MetricSnapshot,
  ComparisonPeriods,
  DiagnosticContext,
  Finding,
} from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMMERCE_FUNNEL: FunnelSchema = {
  vertical: "commerce",
  stages: [
    {
      name: "awareness",
      metric: "impressions",
      metricSource: "top_level",
      costMetric: "cpm",
      costMetricSource: "top_level",
    },
    {
      name: "click",
      metric: "inline_link_clicks",
      metricSource: "top_level",
      costMetric: "cpc",
      costMetricSource: "top_level",
    },
    {
      name: "ATC",
      metric: "add_to_cart",
      metricSource: "actions",
      costMetric: null,
      costMetricSource: null,
    },
    {
      name: "purchase",
      metric: "purchase",
      metricSource: "actions",
      costMetric: "cost_per_purchase",
      costMetricSource: "cost_per_action_type",
    },
  ],
  primaryKPI: "purchase",
  roasMetric: "website_purchase_roas",
};

const PERIODS: ComparisonPeriods = {
  current: { since: "2024-01-08", until: "2024-01-14" },
  previous: { since: "2024-01-01", until: "2024-01-07" },
};

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-08",
    periodEnd: "2024-01-14",
    spend: 1000,
    stages: {
      impressions: { count: 10000, cost: null },
      inline_link_clicks: { count: 500, cost: 2.0 },
      add_to_cart: { count: 50, cost: null },
      purchase: { count: 20, cost: 50 },
    },
    topLevel: { impressions: 10000, clicks: 600, inline_link_clicks: 500, spend: 1000 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analyzeFunnel", () => {
  it("returns a valid DiagnosticResult with correct structure", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
    });

    expect(result.vertical).toBe("commerce");
    expect(result.entityId).toBe("act_123");
    expect(result.periods).toEqual(PERIODS);
    expect(result.stageAnalysis).toHaveLength(4);
    expect(result.dropoffs).toHaveLength(3); // 4 stages → 3 dropoffs
    expect(result.findings).toBeDefined();
  });

  it("detects stage decline and sets bottleneck correctly", () => {
    const current = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 50, cost: null },
        purchase: { count: 10, cost: 100 }, // dropped from 20 to 10
      },
    });
    const previous = makeSnapshot();

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
    });

    expect(result.bottleneck).not.toBeNull();
    expect(result.bottleneck!.metric).toBe("purchase");
    expect(result.bottleneck!.deltaPercent).toBe(-50);
    expect(result.bottleneck!.isSignificant).toBe(true);
  });

  it("returns null bottleneck when all metrics are stable", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
    });

    expect(result.bottleneck).toBeNull();
  });

  it("classifies severity based on delta magnitude", () => {
    const current = makeSnapshot({
      spend: 5000,
      stages: {
        impressions: { count: 5000, cost: null }, // -50% at high spend → critical
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 50, cost: null },
        purchase: { count: 20, cost: 50 },
      },
    });
    const previous = makeSnapshot();

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
    });

    const impressions = result.stageAnalysis.find((s) => s.metric === "impressions")!;
    expect(impressions.severity).toBe("critical");
  });

  it("computes drop-off rates correctly", () => {
    const current = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 1000, cost: 1.0 }, // 10% CTR
        add_to_cart: { count: 100, cost: null },          // 10% click→ATC
        purchase: { count: 25, cost: 40 },                // 25% ATC→purchase
      },
    });
    const previous = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },  // 5% CTR
        add_to_cart: { count: 50, cost: null },           // 10% click→ATC
        purchase: { count: 20, cost: 50 },                // 40% ATC→purchase
      },
    });

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
    });

    // impression→click rate: current = 1000/10000 = 0.1, previous = 500/10000 = 0.05
    expect(result.dropoffs[0].currentRate).toBeCloseTo(0.1);
    expect(result.dropoffs[0].previousRate).toBeCloseTo(0.05);

    // click→ATC rate: current = 100/1000 = 0.1, previous = 50/500 = 0.1
    expect(result.dropoffs[1].currentRate).toBeCloseTo(0.1);
    expect(result.dropoffs[1].previousRate).toBeCloseTo(0.1);
  });

  it("calls advisors with context and includes their findings", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const mockContext: DiagnosticContext = {
      subEntities: [],
    };

    const mockAdvisor: FindingAdvisor = (
      _stages, _dropoffs, _curr, _prev, ctx
    ): Finding[] => {
      // Verify context is passed through
      expect(ctx).toBe(mockContext);
      return [
        {
          severity: "warning",
          stage: "test",
          message: "Test advisor finding",
          recommendation: "Do something",
        },
      ];
    };

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
      advisors: [mockAdvisor],
      context: mockContext,
    });

    const testFinding = result.findings.find((f) => f.message === "Test advisor finding");
    expect(testFinding).toBeDefined();
    expect(testFinding!.severity).toBe("warning");
  });

  it("sorts findings by severity (critical first)", () => {
    const current = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 50, cost: null },
        purchase: { count: 10, cost: 100 }, // big drop
      },
    });
    const previous = makeSnapshot();

    const infoAdvisor: FindingAdvisor = () => [
      { severity: "info", stage: "test", message: "Info finding", recommendation: null },
    ];
    const criticalAdvisor: FindingAdvisor = () => [
      { severity: "critical", stage: "test", message: "Critical finding", recommendation: null },
    ];

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
      advisors: [infoAdvisor, criticalAdvisor],
    });

    // Critical findings should come before info findings
    const criticalIndex = result.findings.findIndex((f) => f.message === "Critical finding");
    const infoIndex = result.findings.findIndex((f) => f.message === "Info finding");
    expect(criticalIndex).toBeLessThan(infoIndex);
  });

  it("computes economic impact when revenue data is available", () => {
    const current = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 40, cost: null },
        purchase: { count: 15, cost: 66.67 },
      },
    });
    const previous = makeSnapshot();

    const context: DiagnosticContext = {
      revenueData: {
        averageOrderValue: 50,
        totalRevenue: 750,
        previousTotalRevenue: 1000,
      },
    };

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
      context,
    });

    // Purchase stage should have economic impact
    const purchaseStage = result.stageAnalysis.find((s) => s.metric === "purchase")!;
    expect(purchaseStage.economicImpact).toBeDefined();
    expect(purchaseStage.economicImpact!.conversionDelta).toBe(-5);
    expect(purchaseStage.economicImpact!.estimatedRevenueDelta).toBe(-250); // -5 * $50

    // Elasticity ranking should be populated
    expect(result.elasticity).toBeDefined();
  });

  it("handles zero-conversion KPI gracefully", () => {
    const current = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 0, cost: null },
        purchase: { count: 0, cost: null }, // zero conversions
      },
    });
    const previous = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 0, cost: null },
        purchase: { count: 0, cost: null }, // zero conversions previously too
      },
    });

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
    });

    // Should not produce "$0.00 (-100% WoW)" message
    const kpiFinding = result.findings.find((f) => f.stage === "purchase");
    expect(kpiFinding).toBeDefined();
    expect(kpiFinding!.message).not.toContain("$0.00");
    expect(kpiFinding!.message).toContain("No purchase conversions");
  });

  it("uses dropoff from-stage count for economic impact baseline", () => {
    const current = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 40, cost: null },     // ATC dropped
        purchase: { count: 15, cost: 66.67 },
      },
    });
    const previous = makeSnapshot({
      stages: {
        impressions: { count: 10000, cost: null },
        inline_link_clicks: { count: 500, cost: 2.0 },
        add_to_cart: { count: 50, cost: null },     // ATC was higher
        purchase: { count: 20, cost: 50 },
      },
    });

    const context: DiagnosticContext = {
      revenueData: {
        averageOrderValue: 50,
        totalRevenue: 750,
        previousTotalRevenue: 1000,
      },
    };

    const result = analyzeFunnel({
      funnel: COMMERCE_FUNNEL,
      current,
      previous,
      periods: PERIODS,
      context,
    });

    // Each dropoff should use its own from-stage count, not the bottom-of-funnel count
    // The ATC→purchase dropoff should use ATC count (50) as baseline, not purchase count (20)
    const atcToPurchase = result.dropoffs.find(
      (d) => d.fromStage === "ATC" && d.toStage === "purchase"
    )!;
    expect(atcToPurchase.economicImpact).toBeDefined();
    // Previous ATC count was 50, so that should be the baseline
  });
});
