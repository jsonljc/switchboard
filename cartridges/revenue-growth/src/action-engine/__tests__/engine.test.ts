// ---------------------------------------------------------------------------
// Action Engine — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  generateIntervention,
  generateInterventionWithLLM,
  estimateImpact,
  lookupActionType,
} from "../engine.js";
import type { Constraint, ScorerOutput } from "@switchboard/schemas";
import { MockLLMClient } from "@switchboard/core";

function makeScorerOutput(score: number): ScorerOutput {
  return {
    scorerName: "signal-health",
    score,
    confidence: score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW",
    issues:
      score < 50
        ? [
            {
              code: "SIGNAL_LOW",
              severity: score < 25 ? "critical" : "warning",
              message: `Signal health score is ${score}`,
            },
          ]
        : [],
    computedAt: new Date().toISOString(),
  };
}

function makeConstraint(
  type: Constraint["type"],
  score: number,
  confidence: Constraint["confidence"] = "HIGH",
): Constraint {
  return {
    type,
    score,
    confidence,
    isPrimary: true,
    scorerOutput: makeScorerOutput(score),
    reason: `Test constraint: ${type} at score ${score}`,
  };
}

describe("estimateImpact", () => {
  it("returns HIGH for critical score with HIGH confidence", () => {
    const result = estimateImpact(makeConstraint("SIGNAL", 20, "HIGH"));
    expect(result).toBe("HIGH");
  });

  it("returns MEDIUM for moderate score", () => {
    const result = estimateImpact(makeConstraint("SIGNAL", 35, "HIGH"));
    expect(result).toBe("MEDIUM");
  });

  it("returns LOW for borderline score", () => {
    const result = estimateImpact(makeConstraint("SIGNAL", 45, "HIGH"));
    expect(result).toBe("LOW");
  });

  it("returns MEDIUM (not HIGH) for critical score with LOW confidence", () => {
    const result = estimateImpact(makeConstraint("SIGNAL", 20, "LOW"));
    expect(result).toBe("MEDIUM");
  });
});

describe("lookupActionType", () => {
  it("maps SIGNAL to FIX_TRACKING", () => {
    expect(lookupActionType("SIGNAL")).toBe("FIX_TRACKING");
  });

  it("maps CREATIVE to REFRESH_CREATIVE", () => {
    expect(lookupActionType("CREATIVE")).toBe("REFRESH_CREATIVE");
  });

  it("maps FUNNEL to OPTIMIZE_FUNNEL", () => {
    expect(lookupActionType("FUNNEL")).toBe("OPTIMIZE_FUNNEL");
  });

  it("maps SALES to IMPROVE_SALES_PROCESS", () => {
    expect(lookupActionType("SALES")).toBe("IMPROVE_SALES_PROCESS");
  });

  it("maps SATURATION to EXPAND_AUDIENCE", () => {
    expect(lookupActionType("SATURATION")).toBe("EXPAND_AUDIENCE");
  });

  it("maps OFFER to REVISE_OFFER", () => {
    expect(lookupActionType("OFFER")).toBe("REVISE_OFFER");
  });

  it("maps CAPACITY to SCALE_CAPACITY", () => {
    expect(lookupActionType("CAPACITY")).toBe("SCALE_CAPACITY");
  });
});

describe("generateIntervention", () => {
  it("creates an intervention from a SIGNAL constraint", () => {
    const constraint = makeConstraint("SIGNAL", 20, "HIGH");
    const cycleId = "cycle-123";

    const intervention = generateIntervention(constraint, cycleId);

    expect(intervention.id).toBeTruthy();
    expect(intervention.cycleId).toBe(cycleId);
    expect(intervention.constraintType).toBe("SIGNAL");
    expect(intervention.actionType).toBe("FIX_TRACKING");
    expect(intervention.status).toBe("PROPOSED");
    expect(intervention.priority).toBe(1);
    expect(intervention.estimatedImpact).toBe("HIGH");
    expect(intervention.reasoning).toContain("SIGNAL");
    expect(intervention.artifacts).toHaveLength(1);
    expect(intervention.artifacts[0]!.type).toBe("brief");
    expect(intervention.outcomeStatus).toBe("PENDING");
    expect(intervention.measurementWindowDays).toBe(7);
    expect(intervention.createdAt).toBeTruthy();
  });

  it("creates intervention with correct priority for each constraint type", () => {
    const types: Array<[Constraint["type"], number]> = [
      ["SIGNAL", 1],
      ["CREATIVE", 2],
      ["FUNNEL", 3],
      ["SALES", 4],
      ["SATURATION", 5],
      ["OFFER", 6],
      ["CAPACITY", 7],
    ];

    for (const [type, expectedPriority] of types) {
      const intervention = generateIntervention(makeConstraint(type, 30), "cycle-1");
      expect(intervention.priority).toBe(expectedPriority);
    }
  });

  it("generates brief content with constraint details", () => {
    const constraint = makeConstraint("SIGNAL", 30);
    const intervention = generateIntervention(constraint, "cycle-1");

    const brief = intervention.artifacts[0]!.content;
    expect(brief).toContain("FIX_TRACKING");
    expect(brief).toContain("SIGNAL");
    expect(brief).toContain("30");
    expect(brief).toContain("Key Issues");
  });
});

describe("generateInterventionWithLLM", () => {
  it("uses LLM client for brief generation", async () => {
    const llm = new MockLLMClient(["LLM-generated action brief with bullet points"]);
    const constraint = makeConstraint("CREATIVE", 20);

    const intervention = await generateInterventionWithLLM(constraint, "cycle-1", llm);

    expect(intervention.artifacts[0]!.content).toContain("LLM-generated");
    expect(intervention.actionType).toBe("REFRESH_CREATIVE");
  });

  it("falls back to template when LLM fails", async () => {
    const failingLLM: import("@switchboard/core").LLMClient = {
      complete: () => {
        throw new Error("LLM unavailable");
      },
      completeStructured: () => {
        throw new Error("LLM unavailable");
      },
    };

    const constraint = makeConstraint("FUNNEL", 30);
    const intervention = await generateInterventionWithLLM(constraint, "cycle-1", failingLLM);

    expect(intervention.artifacts[0]!.content).toContain("OPTIMIZE_FUNNEL");
    expect(intervention.actionType).toBe("OPTIMIZE_FUNNEL");
  });
});
