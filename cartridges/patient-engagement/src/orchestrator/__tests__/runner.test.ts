import { describe, it, expect } from "vitest";
import { runDiagnostic } from "../runner.js";
import type { DiagnosticRunConfig } from "../runner.js";
import type { PatientMetricsSnapshot, ComparisonPeriods } from "../../core/types.js";

function makeSnapshot(overrides: Partial<PatientMetricsSnapshot> = {}): PatientMetricsSnapshot {
  return {
    organizationId: "org-1",
    periodStart: "2025-01-01",
    periodEnd: "2025-01-31",
    totalPatients: 100,
    stages: {
      new_leads: { count: 100, averageValue: null },
      qualified_leads: { count: 60, averageValue: null },
      consultations_booked: { count: 40, averageValue: null },
      consultations_completed: { count: 35, averageValue: null },
      treatments_proposed: { count: 30, averageValue: 500 },
      treatments_accepted: { count: 25, averageValue: 500 },
      treatments_scheduled: { count: 22, averageValue: 500 },
      treatments_completed: { count: 20, averageValue: 500 },
      repeat_patients: { count: 5, averageValue: null },
      dormant_patients: { count: 3, averageValue: null },
      lost_patients: { count: 2, averageValue: null },
    },
    aggregates: {
      averageTreatmentValue: 500,
      totalRevenue: 10000,
      noShowRate: 0.1,
      cancellationRate: 0.05,
      averageResponseTimeMs: 3600000,
      reviewRating: 4.5,
      reviewCount: 20,
      referralCount: 5,
    },
    ...overrides,
  };
}

describe("runDiagnostic", () => {
  const periods: ComparisonPeriods = {
    current: { since: "2025-01-01", until: "2025-01-31" },
    previous: { since: "2024-12-01", until: "2024-12-31" },
  };

  it("returns a diagnostic result with all expected fields", () => {
    const config: DiagnosticRunConfig = {
      organizationId: "org-1",
      clinicType: "dental",
      current: makeSnapshot(),
      previous: makeSnapshot({ totalPatients: 90 }),
      periods,
    };
    const result = runDiagnostic(config);
    expect(result.organizationId).toBe("org-1");
    expect(result.periods).toEqual(periods);
    expect(result.stageAnalysis).toBeInstanceOf(Array);
    expect(result.dropoffs).toBeInstanceOf(Array);
    expect(result.findings).toBeInstanceOf(Array);
    expect(result.primaryKPI).toBeDefined();
    expect(result.totalPatients).toBeDefined();
  });

  it("detects findings when stages decline", () => {
    const current = makeSnapshot({
      stages: {
        new_leads: { count: 50, averageValue: null },
        qualified_leads: { count: 20, averageValue: null },
        consultations_booked: { count: 10, averageValue: null },
        consultations_completed: { count: 8, averageValue: null },
        treatments_proposed: { count: 5, averageValue: 500 },
        treatments_accepted: { count: 3, averageValue: 500 },
        treatments_scheduled: { count: 2, averageValue: 500 },
        treatments_completed: { count: 1, averageValue: 500 },
        repeat_patients: { count: 0, averageValue: null },
        dormant_patients: { count: 5, averageValue: null },
        lost_patients: { count: 10, averageValue: null },
      },
    });
    const previous = makeSnapshot();
    const config: DiagnosticRunConfig = {
      organizationId: "org-1",
      clinicType: "dental",
      current,
      previous,
      periods,
    };
    const result = runDiagnostic(config);
    // Should detect decline in most stages
    expect(result.stageAnalysis.length).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("works with different clinic types", () => {
    const config: DiagnosticRunConfig = {
      organizationId: "org-1",
      clinicType: "aesthetics",
      current: makeSnapshot(),
      previous: makeSnapshot(),
      periods,
    };
    const result = runDiagnostic(config);
    expect(result.organizationId).toBe("org-1");
  });
});
