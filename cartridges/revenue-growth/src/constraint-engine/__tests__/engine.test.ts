// ---------------------------------------------------------------------------
// Constraint Engine — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { identifyConstraints } from "../engine.js";
import type { ScorerOutput } from "@switchboard/schemas";

function makeScorer(name: string, score: number): ScorerOutput {
  return {
    scorerName: name,
    score,
    confidence: score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW",
    issues:
      score < 50
        ? [
            {
              code: `${name.toUpperCase()}_LOW`,
              severity: score < 25 ? "critical" : "warning",
              message: `${name} score is ${score}`,
            },
          ]
        : [],
    computedAt: new Date().toISOString(),
  };
}

describe("identifyConstraints", () => {
  it("returns no primary constraint when all scores are above threshold", () => {
    const result = identifyConstraints(
      [makeScorer("signal-health", 80), makeScorer("creative-depth", 75)],
      null,
    );

    expect(result.primary).toBeNull();
    expect(result.secondary).toHaveLength(0);
    expect(result.constraintTransition).toBe(false);
  });

  it("identifies SIGNAL as primary when signal-health is below threshold", () => {
    const result = identifyConstraints(
      [makeScorer("signal-health", 40), makeScorer("creative-depth", 75)],
      null,
    );

    expect(result.primary).not.toBeNull();
    expect(result.primary!.type).toBe("SIGNAL");
    expect(result.primary!.isPrimary).toBe(true);
    expect(result.primary!.score).toBe(40);
    expect(result.secondary).toHaveLength(0);
  });

  it("identifies CREATIVE as primary when only creative is below threshold", () => {
    const result = identifyConstraints(
      [makeScorer("signal-health", 80), makeScorer("creative-depth", 30)],
      null,
    );

    expect(result.primary).not.toBeNull();
    expect(result.primary!.type).toBe("CREATIVE");
    expect(result.primary!.score).toBe(30);
  });

  it("prioritizes SIGNAL over CREATIVE when both are below threshold", () => {
    const result = identifyConstraints(
      [makeScorer("signal-health", 40), makeScorer("creative-depth", 30)],
      null,
    );

    expect(result.primary!.type).toBe("SIGNAL");
    expect(result.secondary).toHaveLength(1);
    expect(result.secondary[0]!.type).toBe("CREATIVE");
    expect(result.secondary[0]!.isPrimary).toBe(false);
  });

  it("detects constraint transition when primary changes from previous", () => {
    const result = identifyConstraints(
      [makeScorer("signal-health", 80), makeScorer("creative-depth", 30)],
      "SIGNAL",
    );

    expect(result.primary!.type).toBe("CREATIVE");
    expect(result.constraintTransition).toBe(true);
  });

  it("no transition when primary stays the same", () => {
    const result = identifyConstraints(
      [makeScorer("signal-health", 40), makeScorer("creative-depth", 75)],
      "SIGNAL",
    );

    expect(result.primary!.type).toBe("SIGNAL");
    expect(result.constraintTransition).toBe(false);
  });

  it("no transition when previous was null (first run)", () => {
    const result = identifyConstraints([makeScorer("signal-health", 40)], null);

    expect(result.primary!.type).toBe("SIGNAL");
    expect(result.constraintTransition).toBe(false);
  });

  it("handles empty scorer outputs", () => {
    const result = identifyConstraints([], null);

    expect(result.primary).toBeNull();
    expect(result.secondary).toHaveLength(0);
  });

  it("handles unknown scorer names gracefully", () => {
    const result = identifyConstraints([makeScorer("unknown-scorer", 10)], null);

    expect(result.primary).toBeNull();
    expect(result.secondary).toHaveLength(0);
  });

  it("includes reason with top issue message for critical scores", () => {
    const result = identifyConstraints([makeScorer("signal-health", 20)], null);

    expect(result.primary!.reason).toContain("Critical constraint");
    expect(result.primary!.reason).toContain("SIGNAL");
  });

  it("includes reason for binding but non-critical scores", () => {
    const result = identifyConstraints([makeScorer("signal-health", 45)], null);

    expect(result.primary!.reason).toContain("Binding constraint");
  });

  it("orders funnel, sales, and saturation correctly by priority", () => {
    const result = identifyConstraints(
      [
        makeScorer("headroom", 20),
        makeScorer("funnel-leakage", 30),
        makeScorer("sales-process", 25),
      ],
      null,
    );

    expect(result.primary!.type).toBe("FUNNEL");
    expect(result.secondary.map((c) => c.type)).toEqual(["SALES", "SATURATION"]);
  });
});
