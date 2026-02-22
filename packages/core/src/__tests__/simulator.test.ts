import { describe, it, expect } from "vitest";

import { formatSimulationResult } from "../index.js";

import type { DecisionTrace } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    actionId: "action-1",
    envelopeId: "env-1",
    checks: [],
    computedRiskScore: { rawScore: 30, category: "low", factors: [] },
    finalDecision: "allow",
    approvalRequired: "none",
    explanation: "Action allowed.",
    evaluatedAt: new Date(),
    ...overrides,
  };
}

// ===================================================================
// SIMULATOR
// ===================================================================

describe("Simulator — formatSimulationResult", () => {
  it("maps 'allow' decision to wouldExecute=true", () => {
    const result = formatSimulationResult(makeTrace({ finalDecision: "allow" }));
    expect(result.wouldExecute).toBe(true);
  });

  it("maps 'modify' decision to wouldExecute=true", () => {
    const result = formatSimulationResult(makeTrace({ finalDecision: "modify" }));
    expect(result.wouldExecute).toBe(true);
  });

  it("maps 'deny' decision to wouldExecute=false", () => {
    const result = formatSimulationResult(makeTrace({ finalDecision: "deny" }));
    expect(result.wouldExecute).toBe(false);
  });

  it("copies approvalRequired and explanation", () => {
    const trace = makeTrace({
      approvalRequired: "elevated",
      explanation: "Requires elevated approval",
    });
    const result = formatSimulationResult(trace);
    expect(result.approvalRequired).toBe("elevated");
    expect(result.explanation).toBe("Requires elevated approval");
  });

  it("includes the full decisionTrace in result", () => {
    const trace = makeTrace();
    const result = formatSimulationResult(trace);
    expect(result.decisionTrace).toBe(trace);
  });
});
