import { describe, it, expect } from "vitest";
import { dayOfWeekAdvisor } from "../day-of-week.js";
import type { MetricSnapshot, DiagnosticContext, DailyBreakdown } from "../../../core/types.js";

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

function makeDaily(
  date: string,
  dayOfWeek: number,
  spend: number,
  conversions: number
): DailyBreakdown {
  return {
    date,
    dayOfWeek,
    spend,
    impressions: spend * 10,
    clicks: spend,
    conversions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dayOfWeekAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no daily data", () => {
    const findings = dayOfWeekAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when spend change is negligible", () => {
    const current = [
      makeDaily("2024-01-08", 1, 100, 10),
      makeDaily("2024-01-09", 2, 100, 10),
    ];
    const previous = [
      makeDaily("2024-01-01", 1, 98, 10),
      makeDaily("2024-01-02", 2, 98, 10),
    ];
    const context: DiagnosticContext = {
      dailyBreakdowns: current,
      previousDailyBreakdowns: previous,
    };
    const findings = dayOfWeekAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("flags when single day drives >50% of WoW change", () => {
    const current = [
      makeDaily("2024-01-08", 1, 200, 20), // Monday doubled
      makeDaily("2024-01-09", 2, 100, 10),
      makeDaily("2024-01-10", 3, 100, 10),
      makeDaily("2024-01-11", 4, 100, 10),
      makeDaily("2024-01-12", 5, 100, 10),
    ];
    const previous = [
      makeDaily("2024-01-01", 1, 50, 5),   // Monday was much lower
      makeDaily("2024-01-02", 2, 100, 10),
      makeDaily("2024-01-03", 3, 100, 10),
      makeDaily("2024-01-04", 4, 100, 10),
      makeDaily("2024-01-05", 5, 100, 10),
    ];
    const context: DiagnosticContext = {
      dailyBreakdowns: current,
      previousDailyBreakdowns: previous,
    };
    const findings = dayOfWeekAdvisor([], [], snapshot, snapshot, context);
    expect(findings.some((f) => f.message.includes("Monday"))).toBe(true);
  });

  it("detects weekend vs weekday CPA disparity", () => {
    const current = [
      makeDaily("2024-01-08", 1, 100, 20),  // Weekday: CPA $5
      makeDaily("2024-01-09", 2, 100, 20),
      makeDaily("2024-01-10", 3, 100, 20),
      makeDaily("2024-01-11", 4, 100, 20),
      makeDaily("2024-01-12", 5, 100, 20),
      makeDaily("2024-01-13", 6, 200, 5),  // Saturday: CPA $40
      makeDaily("2024-01-14", 0, 200, 5),  // Sunday: CPA $40
    ];
    const previous = [
      makeDaily("2024-01-01", 1, 80, 16),
      makeDaily("2024-01-02", 2, 80, 16),
      makeDaily("2024-01-03", 3, 80, 16),
      makeDaily("2024-01-04", 4, 80, 16),
      makeDaily("2024-01-05", 5, 80, 16),
      makeDaily("2024-01-06", 6, 80, 2),
      makeDaily("2024-01-07", 0, 80, 2),
    ];
    const context: DiagnosticContext = {
      dailyBreakdowns: current,
      previousDailyBreakdowns: previous,
    };
    const findings = dayOfWeekAdvisor([], [], snapshot, snapshot, context);

    const weekendFinding = findings.find((f) => f.message.includes("Weekend CPA"));
    expect(weekendFinding).toBeDefined();
    expect(weekendFinding!.severity).toBe("warning");
  });

  it("flags multiple zero-conversion days", () => {
    const current = [
      makeDaily("2024-01-08", 1, 200, 30),
      makeDaily("2024-01-09", 2, 200, 30),
      makeDaily("2024-01-10", 3, 200, 30),
      makeDaily("2024-01-11", 4, 200, 30),
      makeDaily("2024-01-12", 5, 200, 30),
      makeDaily("2024-01-13", 6, 100, 0), // Zero conversions
      makeDaily("2024-01-14", 0, 100, 0), // Zero conversions
    ];
    const previous = [
      makeDaily("2024-01-01", 1, 100, 10),
      makeDaily("2024-01-02", 2, 100, 10),
      makeDaily("2024-01-03", 3, 100, 10),
      makeDaily("2024-01-04", 4, 100, 10),
      makeDaily("2024-01-05", 5, 100, 10),
      makeDaily("2024-01-06", 6, 50, 0),
      makeDaily("2024-01-07", 0, 50, 0),
    ];
    const context: DiagnosticContext = {
      dailyBreakdowns: current,
      previousDailyBreakdowns: previous,
    };
    const findings = dayOfWeekAdvisor([], [], snapshot, snapshot, context);

    expect(findings.some((f) => f.message.includes("zero conversions"))).toBe(true);
  });
});
