// ---------------------------------------------------------------------------
// Tests: Journey Walker
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { analyzeJourney } from "../core/analysis/journey-walker.js";
import { PATIENT_JOURNEY_SCHEMA } from "../core/types.js";
import type { PatientMetricsSnapshot, ComparisonPeriods } from "../core/types.js";

function makeSnapshot(overrides: Partial<PatientMetricsSnapshot> = {}): PatientMetricsSnapshot {
  return {
    organizationId: "org-1",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    totalPatients: 100,
    stages: {
      new_leads: { count: 50, averageValue: null },
      qualified_leads: { count: 30, averageValue: null },
      consultations_booked: { count: 20, averageValue: null },
      consultations_completed: { count: 18, averageValue: null },
      treatments_proposed: { count: 15, averageValue: 500 },
      treatments_accepted: { count: 12, averageValue: 500 },
      treatments_scheduled: { count: 10, averageValue: 500 },
      treatments_completed: { count: 8, averageValue: 500 },
      repeat_patients: { count: 3, averageValue: 600 },
    },
    aggregates: {
      averageTreatmentValue: 500,
      totalRevenue: 4000,
      noShowRate: 0.1,
      cancellationRate: 0.05,
      averageResponseTimeMs: 900000,
      reviewRating: 4.5,
      reviewCount: 5,
      referralCount: 2,
    },
    ...overrides,
  };
}

const periods: ComparisonPeriods = {
  current: { since: "2024-01-08", until: "2024-01-14" },
  previous: { since: "2024-01-01", until: "2024-01-07" },
};

describe("analyzeJourney", () => {
  it("should produce a diagnostic result with stage analysis", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();

    const result = analyzeJourney({
      schema: PATIENT_JOURNEY_SCHEMA,
      current,
      previous,
      periods,
    });

    expect(result.organizationId).toBe("org-1");
    expect(result.stageAnalysis.length).toBeGreaterThan(0);
    expect(result.dropoffs.length).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("should detect bottleneck when a stage drops significantly", () => {
    const previous = makeSnapshot();
    const current = makeSnapshot({
      totalPatients: 100,
      stages: {
        ...makeSnapshot().stages,
        consultations_booked: { count: 5, averageValue: null }, // 75% drop
      },
    });

    const result = analyzeJourney({
      schema: PATIENT_JOURNEY_SCHEMA,
      current,
      previous,
      periods,
    });

    expect(result.bottleneck).not.toBeNull();
    expect(result.bottleneck?.stageId).toBe("consultation_booked");
  });

  it("should report healthy when no significant changes", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();

    const result = analyzeJourney({
      schema: PATIENT_JOURNEY_SCHEMA,
      current,
      previous,
      periods,
    });

    expect(result.primaryKPI.severity).toBe("healthy");
    expect(result.bottleneck).toBeNull();
  });

  it("should include advisor findings when advisors are provided", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();

    const mockAdvisor = () => [
      {
        severity: "info" as const,
        stage: "test",
        message: "Test finding",
        recommendation: null,
      },
    ];

    const result = analyzeJourney({
      schema: PATIENT_JOURNEY_SCHEMA,
      current,
      previous,
      periods,
      advisors: [mockAdvisor],
    });

    expect(result.findings.some((f) => f.message === "Test finding")).toBe(true);
  });

  it("should sort findings by severity", () => {
    const current = makeSnapshot({
      stages: {
        ...makeSnapshot().stages,
        treatments_completed: { count: 1, averageValue: 500 }, // big drop
      },
    });
    const previous = makeSnapshot();

    const result = analyzeJourney({
      schema: PATIENT_JOURNEY_SCHEMA,
      current,
      previous,
      periods,
    });

    const severityOrder = { critical: 0, warning: 1, info: 2, healthy: 3 };
    for (let i = 1; i < result.findings.length; i++) {
      expect(severityOrder[result.findings[i]!.severity]).toBeGreaterThanOrEqual(
        severityOrder[result.findings[i - 1]!.severity],
      );
    }
  });
});
