import { describe, it, expect } from "vitest";
import { detectCorrelations } from "../correlator.js";
import type {
  JourneyDiagnosticResult,
  JourneyStageDiagnostic,
  JourneyDropoff,
} from "../../core/types.js";

function makeResult(overrides: Partial<JourneyDiagnosticResult> = {}): JourneyDiagnosticResult {
  return {
    organizationId: "org-1",
    periods: {
      current: { since: "2025-01-01", until: "2025-01-31" },
      previous: { since: "2024-12-01", until: "2024-12-31" },
    },
    totalContacts: { current: 100, previous: 90 },
    primaryKPI: {
      name: "services_completed",
      current: 50,
      previous: 45,
      deltaPercent: 11.1,
      severity: "healthy",
    },
    stageAnalysis: [],
    dropoffs: [],
    bottleneck: null,
    findings: [],
    ...overrides,
  };
}

function makeStage(overrides: Partial<JourneyStageDiagnostic> = {}): JourneyStageDiagnostic {
  return {
    stageName: "Stage",
    stageId: "qualified",
    metric: "qualified_leads",
    currentValue: 50,
    previousValue: 60,
    delta: -10,
    deltaPercent: -16.7,
    isSignificant: true,
    severity: "warning",
    ...overrides,
  };
}

describe("detectCorrelations", () => {
  it("returns no findings when there are no correlation patterns", () => {
    const result = makeResult({
      stageAnalysis: [
        makeStage({ stageId: "qualified", deltaPercent: 5 }),
        makeStage({ stageId: "consultation_booked", deltaPercent: 3 }),
      ],
    });
    const findings = detectCorrelations(result);
    expect(findings).toHaveLength(0);
  });

  it("detects systemic lead quality issue (qualification AND booking both dropping)", () => {
    const result = makeResult({
      stageAnalysis: [
        makeStage({ stageId: "qualified", deltaPercent: -15 }),
        makeStage({ stageId: "consultation_booked", deltaPercent: -12 }),
      ],
    });
    const findings = detectCorrelations(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.stage).toBe("cross-stage");
    expect(findings[0]!.message).toContain("systemic lead quality");
    expect(findings[0]!.recommendation).toContain("Audit lead sources");
  });

  it("does not trigger lead quality issue if only one is dropping", () => {
    const result = makeResult({
      stageAnalysis: [
        makeStage({ stageId: "qualified", deltaPercent: -15 }),
        makeStage({ stageId: "consultation_booked", deltaPercent: 5 }),
      ],
    });
    expect(detectCorrelations(result)).toHaveLength(0);
  });

  it("does not trigger lead quality issue if drop is minor (< -10%)", () => {
    const result = makeResult({
      stageAnalysis: [
        makeStage({ stageId: "qualified", deltaPercent: -8 }),
        makeStage({ stageId: "consultation_booked", deltaPercent: -9 }),
      ],
    });
    expect(detectCorrelations(result)).toHaveLength(0);
  });

  it("detects pricing issue (proposals dropping, acceptance stable)", () => {
    const result = makeResult({
      stageAnalysis: [
        makeStage({ stageId: "service_proposed", deltaPercent: -20 }),
        makeStage({ stageId: "service_accepted", deltaPercent: 2 }),
      ],
    });
    const findings = detectCorrelations(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("info");
    expect(findings[0]!.message).toContain("Treatment proposals dropping");
    expect(findings[0]!.recommendation).toContain("consultation-to-proposal");
  });

  it("does not trigger pricing issue if acceptance also dropping", () => {
    const result = makeResult({
      stageAnalysis: [
        makeStage({ stageId: "service_proposed", deltaPercent: -20 }),
        makeStage({ stageId: "service_accepted", deltaPercent: -10 }),
      ],
    });
    // Only checks if acceptance delta is within +/- 5%
    expect(detectCorrelations(result)).toHaveLength(0);
  });

  it("detects schedule management issue (low booking + low completion)", () => {
    const dropoffs: JourneyDropoff[] = [
      {
        fromStage: "Qualified",
        toStage: "Consultation Booked",
        currentRate: 0.3,
        previousRate: 0.5,
        deltaPercent: -40,
      },
      {
        fromStage: "Consultation Booked",
        toStage: "Consultation Completed",
        currentRate: 0.6,
        previousRate: 0.8,
        deltaPercent: -25,
      },
    ];
    const result = makeResult({
      totalContacts: { current: 50, previous: 40 },
      dropoffs,
    });
    const findings = detectCorrelations(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain("schedule management");
    expect(findings[0]!.recommendation).toContain("Simplify booking flow");
  });

  it("does not trigger schedule issue for small patient count (≤20)", () => {
    const dropoffs: JourneyDropoff[] = [
      {
        fromStage: "Qualified",
        toStage: "Consultation Booked",
        currentRate: 0.3,
        previousRate: 0.5,
        deltaPercent: -40,
      },
      {
        fromStage: "Consultation Booked",
        toStage: "Consultation Completed",
        currentRate: 0.6,
        previousRate: 0.8,
        deltaPercent: -25,
      },
    ];
    const result = makeResult({
      totalContacts: { current: 15, previous: 10 },
      dropoffs,
    });
    expect(detectCorrelations(result)).toHaveLength(0);
  });

  it("can detect multiple patterns simultaneously", () => {
    const result = makeResult({
      totalContacts: { current: 50, previous: 40 },
      stageAnalysis: [
        makeStage({ stageId: "qualified", deltaPercent: -15 }),
        makeStage({ stageId: "consultation_booked", deltaPercent: -12 }),
        makeStage({ stageId: "service_proposed", deltaPercent: -20 }),
        makeStage({ stageId: "service_accepted", deltaPercent: 1 }),
      ],
      dropoffs: [
        {
          fromStage: "Qualified",
          toStage: "Consultation Booked",
          currentRate: 0.3,
          previousRate: 0.5,
          deltaPercent: -40,
        },
        {
          fromStage: "Consultation Booked",
          toStage: "Consultation Completed",
          currentRate: 0.5,
          previousRate: 0.8,
          deltaPercent: -37.5,
        },
      ],
    });
    const findings = detectCorrelations(result);
    expect(findings).toHaveLength(3);
  });
});
