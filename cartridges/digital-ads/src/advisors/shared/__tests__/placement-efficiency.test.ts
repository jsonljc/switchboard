import { describe, it, expect } from "vitest";
import { placementEfficiencyAdvisor } from "../placement-efficiency.js";
import type { MetricSnapshot, DiagnosticContext, PlacementBreakdown } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
  };
}

function makePlacement(overrides: Partial<PlacementBreakdown> = {}): PlacementBreakdown {
  return {
    placement: "feed",
    spend: 100,
    impressions: 10000,
    clicks: 200,
    conversions: 10,
    cpa: 10,
    cpm: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("placementEfficiencyAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no placement data", () => {
    const findings = placementEfficiencyAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when all placements perform evenly", () => {
    const placements = [
      makePlacement({ placement: "feed", spend: 500, conversions: 25 }),
      makePlacement({ placement: "stories", spend: 300, conversions: 15 }),
      makePlacement({ placement: "reels", spend: 200, conversions: 10 }),
    ];
    const context: DiagnosticContext = { placementBreakdowns: placements };
    const findings = placementEfficiencyAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("flags placement with CPA > 2x average and >10% spend share", () => {
    const placements = [
      makePlacement({ placement: "feed", spend: 500, conversions: 50 }),      // CPA $10
      makePlacement({ placement: "audience_network", spend: 200, conversions: 2 }), // CPA $100 (10x)
      makePlacement({ placement: "stories", spend: 300, conversions: 30 }),    // CPA $10
    ];
    const context: DiagnosticContext = { placementBreakdowns: placements };
    const findings = placementEfficiencyAdvisor([], [], snapshot, snapshot, context);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.message.includes("audience_network"))).toBe(true);
  });

  it("flags placement with spend but zero conversions", () => {
    const placements = [
      makePlacement({ placement: "feed", spend: 700, conversions: 70 }),
      makePlacement({ placement: "right_column", spend: 300, conversions: 0 }),
    ];
    const context: DiagnosticContext = { placementBreakdowns: placements };
    const findings = placementEfficiencyAdvisor([], [], snapshot, snapshot, context);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const zeroConversion = findings.find((f) =>
      f.message.includes("zero conversions")
    );
    expect(zeroConversion).toBeDefined();
  });

  it("does not flag small-spend placements with poor CPA", () => {
    const placements = [
      makePlacement({ placement: "feed", spend: 900, conversions: 90 }),
      makePlacement({ placement: "right_column", spend: 10, conversions: 0 }), // <5% of spend
      makePlacement({ placement: "stories", spend: 90, conversions: 9 }),
    ];
    const context: DiagnosticContext = { placementBreakdowns: placements };
    const findings = placementEfficiencyAdvisor([], [], snapshot, snapshot, context);
    // right_column has only 1% of spend, should not trigger
    expect(findings.every((f) => !f.message.includes("right_column"))).toBe(true);
  });

  it("returns no findings when total conversions are zero", () => {
    const placements = [
      makePlacement({ placement: "feed", spend: 500, conversions: 0 }),
      makePlacement({ placement: "stories", spend: 500, conversions: 0 }),
    ];
    const context: DiagnosticContext = { placementBreakdowns: placements };
    const findings = placementEfficiencyAdvisor([], [], snapshot, snapshot, context);
    // Total conversions = 0, function returns early
    expect(findings).toHaveLength(0);
  });
});
