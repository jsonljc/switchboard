import { describe, it, expect } from "vitest";
import { scoreResults, compareAgainstBaseline } from "../score.js";
import type { InvocationResult } from "../invoke-classifier.js";
import type { Baseline } from "../schema.js";

const r = (
  id: string,
  expected: string,
  predicted: string,
  matched: boolean,
): InvocationResult => ({
  fixtureId: id,
  expected: expected as any,
  acceptable: [expected as any],
  predicted: predicted as any,
  matched,
  confidence: 0.9,
  latencyMs: 100,
  promptHash: "h",
  promptVersion: "v",
});

describe("scoreResults", () => {
  it("computes per-claim-type accuracy", () => {
    const results = [
      r("a", "efficacy", "efficacy", true),
      r("b", "efficacy", "none", false),
      r("c", "urgency", "urgency", true),
    ];
    const report = scoreResults(results);
    expect(report.totalFixtures).toBe(3);
    expect(report.overallAccuracy).toBeCloseTo(2 / 3, 3);
    expect(report.perClaimTypeAccuracy.efficacy).toEqual({
      correct: 1,
      total: 2,
      accuracy: 0.5,
    });
    expect(report.perClaimTypeAccuracy.urgency).toEqual({
      correct: 1,
      total: 1,
      accuracy: 1,
    });
  });

  it("returns zero entries for unseen claim types", () => {
    const report = scoreResults([r("a", "efficacy", "efficacy", true)]);
    expect(report.perClaimTypeAccuracy["safety-claim"]).toEqual({
      correct: 0,
      total: 0,
      accuracy: 0,
    });
  });
});

describe("compareAgainstBaseline", () => {
  const baseline: Baseline = {
    version: 1,
    generatedAt: "2026-05-16T00:00:00.000Z",
    classifierPromptHash: "h1",
    classifierPromptVersion: "claim-classifier@1.0.0",
    totalFixtures: 10,
    overallAccuracy: 0.9,
    perClaimTypeAccuracy: {
      efficacy: { correct: 5, total: 5, accuracy: 1.0 },
      urgency: { correct: 4, total: 5, accuracy: 0.8 },
      "safety-claim": { correct: 0, total: 0, accuracy: 0 },
      superiority: { correct: 0, total: 0, accuracy: 0 },
      testimonial: { correct: 0, total: 0, accuracy: 0 },
      "medical-advice": { correct: 0, total: 0, accuracy: 0 },
      diagnosis: { correct: 0, total: 0, accuracy: 0 },
      credentials: { correct: 0, total: 0, accuracy: 0 },
      none: { correct: 0, total: 0, accuracy: 0 },
    },
    toleranceBps: 200,
  };

  it("passes when accuracy holds within tolerance", () => {
    const report = scoreResults([
      r("a", "efficacy", "efficacy", true),
      r("b", "efficacy", "efficacy", true),
      r("c", "efficacy", "efficacy", true),
      r("d", "efficacy", "efficacy", true),
      r("e", "efficacy", "efficacy", true),
      r("f", "urgency", "urgency", true),
      r("g", "urgency", "urgency", true),
      r("h", "urgency", "urgency", true),
      r("i", "urgency", "urgency", true),
      r("j", "urgency", "none", false),
    ]);
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(true);
    expect(out.regressions).toHaveLength(0);
  });

  it("fails when a claim type drops more than tolerance", () => {
    const report = scoreResults([
      r("a", "efficacy", "none", false),
      r("b", "efficacy", "none", false),
      r("c", "efficacy", "none", false),
      r("d", "efficacy", "efficacy", true),
      r("e", "efficacy", "efficacy", true),
    ]);
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/efficacy/);
  });

  it("ignores baseline categories with zero samples in the current run", () => {
    const report = scoreResults([r("a", "efficacy", "efficacy", true)]);
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(true);
  });
});
