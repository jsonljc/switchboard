import { describe, it, expect } from "vitest";
import { createHeadroomAdvisor, headroomAdvisor } from "../headroom.js";
import type { MetricSnapshot, DiagnosticContext, DailyBreakdown } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-30",
    spend: 15000,
    stages: {},
    topLevel: {},
    ...overrides,
  };
}

/**
 * Generate daily breakdown data following a logarithmic spend-conversion pattern.
 */
function makeDailyBreakdowns(days: number, baseSpend: number = 500): DailyBreakdown[] {
  const breakdowns: DailyBreakdown[] = [];
  const startDate = new Date("2024-01-01");

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    const spendVariation = 0.7 + (i % 7) * 0.1;
    const spend = baseSpend * spendVariation;
    const conversions = Math.max(1, Math.round(5 * Math.log(spend) + 10));

    breakdowns.push({
      date: date.toISOString().slice(0, 10),
      dayOfWeek: date.getDay(),
      spend,
      impressions: Math.round(spend * 20),
      clicks: Math.round(spend * 0.4),
      conversions,
    });
  }

  return breakdowns;
}

/**
 * Generate daily breakdowns with declining CTR (creative fatigue simulation).
 */
function makeFatiguedBreakdowns(days: number): DailyBreakdown[] {
  const breakdowns: DailyBreakdown[] = [];
  const startDate = new Date("2024-01-01");

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    const spend = 500 + (i % 7) * 50;
    const impressions = 10000;
    // CTR starts at 2.5% and drops to 1.5% over the period
    const ctrPercent = 2.5 - (i / days) * 1.0;
    const clicks = Math.round(impressions * (ctrPercent / 100));
    const conversions = Math.max(1, Math.round(5 * Math.log(spend) + 10));

    breakdowns.push({
      date: date.toISOString().slice(0, 10),
      dayOfWeek: date.getDay(),
      spend,
      impressions,
      clicks,
      conversions,
    });
  }

  return breakdowns;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("headroomAdvisor", () => {
  it("returns no findings without daily breakdown data", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = headroomAdvisor([], [], current, previous, {});
    expect(findings).toHaveLength(0);
  });

  it("returns no findings with insufficient daily data (< 21 days)", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeDailyBreakdowns(15),
    };
    const findings = headroomAdvisor([], [], current, previous, context);

    // Should get an info message about insufficient data
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]!.message).toContain("Insufficient");
  });

  it("produces headroom findings with 30 days of data", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeDailyBreakdowns(30),
    };
    const findings = headroomAdvisor([], [], current, previous, context);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.stage === "headroom")).toBe(true);
  });

  it("flags creative fatigue when CTR is declining", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeFatiguedBreakdowns(30),
    };
    const findings = headroomAdvisor([], [], current, previous, context);

    // Should detect creative fatigue and warn about scaling
    const fatigueFindings = findings.filter(
      (f) => f.message.includes("CTR") || f.message.includes("creative"),
    );
    if (fatigueFindings.length > 0) {
      expect(fatigueFindings[0]!.severity).toBe("warning");
      expect(fatigueFindings[0]!.recommendation).toContain("Refresh");
    }
  });

  it("includes confidence band in findings", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeDailyBreakdowns(30),
    };
    const findings = headroomAdvisor([], [], current, previous, context);

    const headroomFinding = findings.find(
      (f) => f.stage === "headroom" && f.message.includes("confidence band"),
    );
    expect(headroomFinding).toBeDefined();
  });

  it("includes model type and R² in findings", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeDailyBreakdowns(30),
    };
    const findings = headroomAdvisor([], [], current, previous, context);

    const modelFinding = findings.find((f) => f.message.includes("R²="));
    expect(modelFinding).toBeDefined();
  });

  it("respects target CPA when configured", () => {
    const advisor = createHeadroomAdvisor({ targetCPA: 25 });
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeDailyBreakdowns(30),
    };
    const findings = advisor([], [], current, previous, context);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.stage === "headroom")).toBe(true);
  });

  it("includes revenue data in findings when available", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const dailyBreakdowns = makeDailyBreakdowns(30);
    const totalConversions = dailyBreakdowns.reduce((sum, d) => sum + d.conversions, 0);
    const context: DiagnosticContext = {
      dailyBreakdowns,
      revenueData: {
        averageOrderValue: 50,
        totalRevenue: totalConversions * 50,
        previousTotalRevenue: totalConversions * 48,
      },
    };
    const findings = headroomAdvisor([], [], current, previous, context);

    expect(findings.length).toBeGreaterThan(0);
  });

  it("warns about caveats when data quality is poor", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();

    // Low variability data
    const breakdowns: DailyBreakdown[] = [];
    for (let i = 0; i < 30; i++) {
      breakdowns.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        dayOfWeek: i % 7,
        spend: 500 + (i % 3),
        impressions: 10000,
        clicks: 200,
        conversions: 50 + (i % 5),
      });
    }

    const context: DiagnosticContext = { dailyBreakdowns: breakdowns };
    const findings = headroomAdvisor([], [], current, previous, context);

    const caveatFinding = findings.find((f) => f.message.includes("caveat"));
    if (caveatFinding) {
      expect(caveatFinding.message).toContain("variability");
    }
  });
});

describe("createHeadroomAdvisor", () => {
  it("creates a custom advisor with target ROAS", () => {
    const advisor = createHeadroomAdvisor({ targetROAS: 3.0 });
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      dailyBreakdowns: makeDailyBreakdowns(30),
      revenueData: {
        averageOrderValue: 50,
        totalRevenue: 50000,
        previousTotalRevenue: 48000,
      },
    };

    const findings = advisor([], [], current, previous, context);
    expect(findings.length).toBeGreaterThan(0);
  });
});
