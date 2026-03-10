// ---------------------------------------------------------------------------
// Outcome Calibrator — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { calibrateFromHistory } from "../calibrator.js";
import type { Intervention } from "@switchboard/schemas";

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle_1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "EXECUTED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "Test reason",
    artifacts: [],
    outcomeStatus: "PENDING",
    measurementWindowDays: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("calibrateFromHistory", () => {
  it("returns empty map for no interventions", () => {
    const result = calibrateFromHistory([]);
    expect(result.size).toBe(0);
  });

  it("ignores PENDING and MEASURING interventions", () => {
    const interventions = [
      makeIntervention({ outcomeStatus: "PENDING" }),
      makeIntervention({ outcomeStatus: "MEASURING" }),
    ];
    const result = calibrateFromHistory(interventions);
    expect(result.size).toBe(0);
  });

  it("computes success rate for IMPROVED outcomes", () => {
    const interventions = [
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "IMPROVED" }),
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "IMPROVED" }),
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "NO_CHANGE" }),
    ];

    const result = calibrateFromHistory(interventions);
    expect(result.has("SIGNAL")).toBe(true);
    const entry = result.get("SIGNAL")!;
    expect(entry.successRate).toBeCloseTo(2 / 3);
    expect(entry.totalCount).toBe(3);
  });

  it("groups by constraint type", () => {
    const interventions = [
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "IMPROVED" }),
      makeIntervention({ constraintType: "CREATIVE", outcomeStatus: "REGRESSED" }),
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "NO_CHANGE" }),
    ];

    const result = calibrateFromHistory(interventions);
    expect(result.size).toBe(2);
    expect(result.get("SIGNAL")!.successRate).toBe(0.5);
    expect(result.get("CREATIVE")!.successRate).toBe(0);
  });

  it("computes avgImprovement for improved interventions", () => {
    const interventions = [
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "IMPROVED", priority: 1 }),
      makeIntervention({ constraintType: "SIGNAL", outcomeStatus: "IMPROVED", priority: 3 }),
    ];

    const result = calibrateFromHistory(interventions);
    const entry = result.get("SIGNAL")!;
    expect(entry.avgImprovement).toBe(10); // (1*5 + 3*5) / 2 = 10
  });

  it("returns 0 avgImprovement when no improved", () => {
    const interventions = [
      makeIntervention({ constraintType: "FUNNEL", outcomeStatus: "REGRESSED" }),
    ];

    const result = calibrateFromHistory(interventions);
    expect(result.get("FUNNEL")!.avgImprovement).toBe(0);
  });
});
