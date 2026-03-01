import { describe, it, expect } from "vitest";
import { marginalEfficiencyAdvisor } from "../marginal-efficiency.js";
import type { MetricSnapshot, StageMetrics } from "../../../core/types.js";

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

function stagesWithConversions(count: number, cost: number): Record<string, StageMetrics> {
  return {
    purchase: { count, cost },
    impressions: { count: 10000, cost: null },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("marginalEfficiencyAdvisor", () => {
  it("returns no findings when spend decreased", () => {
    const current = makeSnapshot({ spend: 800 });
    const previous = makeSnapshot({ spend: 1000 });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when spend increase is < 10%", () => {
    const current = makeSnapshot({
      spend: 1050,
      stages: stagesWithConversions(50, 21),
    });
    const previous = makeSnapshot({
      spend: 1000,
      stages: stagesWithConversions(48, 20.8),
    });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags critical when spend up but conversions flat/down", () => {
    const current = makeSnapshot({
      spend: 1500,
      stages: stagesWithConversions(40, 37.5),
    });
    const previous = makeSnapshot({
      spend: 1000,
      stages: stagesWithConversions(45, 22.2),
    });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("zero additional conversions");
  });

  it("flags warning when marginal CPA > 2x blended CPA", () => {
    // Spend +50% ($1000 → $1500), conversions +10% (50 → 55)
    // Blended CPA = $1500/55 = $27.27
    // Marginal CPA = $500/5 = $100 → 3.67x blended
    const current = makeSnapshot({
      spend: 1500,
      stages: stagesWithConversions(55, 27.27),
    });
    const previous = makeSnapshot({
      spend: 1000,
      stages: stagesWithConversions(50, 20),
    });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical"); // >3x = critical
    expect(findings[0].message).toContain("Marginal CPA");
  });

  it("flags warning for moderate diminishing returns (2-3x)", () => {
    // Spend +30% ($1000 → $1300), conversions +12% (50 → 56)
    // Blended CPA = $1300/56 = $23.21
    // Marginal CPA = $300/6 = $50 → 2.15x blended
    const current = makeSnapshot({
      spend: 1300,
      stages: stagesWithConversions(56, 23.21),
    });
    const previous = makeSnapshot({
      spend: 1000,
      stages: stagesWithConversions(50, 20),
    });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("reports healthy efficient scaling", () => {
    // Spend +30% ($1000 → $1300), conversions +40% (50 → 70)
    // Blended CPA = $1300/70 = $18.57
    // Marginal CPA = $300/20 = $15 → 0.81x blended
    const current = makeSnapshot({
      spend: 1300,
      stages: stagesWithConversions(70, 18.57),
    });
    const previous = makeSnapshot({
      spend: 1000,
      stages: stagesWithConversions(50, 20),
    });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("healthy");
    expect(findings[0].message).toContain("Efficient scaling");
  });

  it("returns no findings when no conversion data", () => {
    const current = makeSnapshot({ spend: 1500 });
    const previous = makeSnapshot({ spend: 1000 });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("falls back to topLevel conversions when stages have no cost", () => {
    const current = makeSnapshot({
      spend: 1500,
      topLevel: { conversions: 55 },
    });
    const previous = makeSnapshot({
      spend: 1000,
      topLevel: { conversions: 50 },
    });
    const findings = marginalEfficiencyAdvisor([], [], current, previous);

    expect(findings.length).toBeGreaterThan(0);
  });
});
