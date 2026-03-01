import { describe, it, expect } from "vitest";
import { bidStrategyAdvisor } from "../bid-strategy.js";
import type { MetricSnapshot, StageDiagnostic } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
    ...overrides,
  };
}

function makeStageAnalysis(
  overrides: Partial<StageDiagnostic> = {}
): StageDiagnostic[] {
  return [
    {
      stageName: "purchase",
      metric: "purchase",
      currentValue: 50,
      previousValue: 50,
      delta: 0,
      deltaPercent: 0,
      isSignificant: false,
      severity: "healthy",
      ...overrides,
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bidStrategyAdvisor", () => {
  it("returns no findings when bid_strategy is not set", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = bidStrategyAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags lowest cost: CPA up + conversions up = buying lower quality", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 1, cost_per_conversion: 25, cpm: 12 },
      spend: 1200,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 1, cost_per_conversion: 20, cpm: 10 },
      spend: 1000,
    });
    const stages = makeStageAnalysis({
      metric: "purchase",
      currentValue: 60,
      previousValue: 50,
      deltaPercent: 20,
    });
    const findings = bidStrategyAdvisor(stages, [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Lowest cost");
    expect(findings[0].message).toContain("more expensive traffic");
  });

  it("flags lowest cost: CPA up + CPM up = auction competition", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 1, cost_per_conversion: 30, cpm: 14 },
      spend: 1200,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 1, cost_per_conversion: 20, cpm: 10 },
      spend: 1000,
    });
    const stages = makeStageAnalysis({
      metric: "purchase",
      currentValue: 45,
      previousValue: 50,
      deltaPercent: -10,
    });
    const findings = bidStrategyAdvisor(stages, [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("auction competition");
  });

  it("flags cost cap: under-delivery with stable CPA", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 2, cost_per_conversion: 20 },
      spend: 700,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 2, cost_per_conversion: 19 },
      spend: 1000,
    });
    const findings = bidStrategyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Cost cap");
    expect(findings[0].message).toContain("throttling");
  });

  it("flags cost cap: CPA exceeding cap", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 2, cost_per_conversion: 30 },
      spend: 1000,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 2, cost_per_conversion: 20 },
      spend: 1000,
    });
    const findings = bidStrategyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("exceeding the cost cap");
  });

  it("flags target ROAS: volume drop with stable ROAS", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 3, roas: 4.0 },
      spend: 1000,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 3, roas: 4.2 },
      spend: 1000,
    });
    const stages = makeStageAnalysis({
      metric: "conversions",
      currentValue: 40,
      previousValue: 50,
      deltaPercent: -20,
    });
    const findings = bidStrategyAdvisor(stages, [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("Target ROAS");
    expect(findings[0].message).toContain("volume dropped");
  });

  it("flags target ROAS: declining ROAS", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 3, roas: 2.5 },
      spend: 1000,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 3, roas: 4.0 },
      spend: 1000,
    });
    const findings = bidStrategyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("ROAS dropped");
  });

  it("flags bid cap: severe under-delivery with rising CPMs", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 4, cpm: 15 },
      spend: 500,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 4, cpm: 10 },
      spend: 1000,
    });
    const findings = bidStrategyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("Bid cap");
  });

  it("does not flag bid cap with minor spend fluctuation", () => {
    const current = makeSnapshot({
      topLevel: { bid_strategy: 4, cpm: 10 },
      spend: 900,
    });
    const previous = makeSnapshot({
      topLevel: { bid_strategy: 4, cpm: 10 },
      spend: 1000,
    });
    const findings = bidStrategyAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });
});
