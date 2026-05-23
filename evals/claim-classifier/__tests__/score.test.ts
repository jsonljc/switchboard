import { describe, it, expect } from "vitest";
import { scoreResults, compareAgainstBaseline, countWrong, type ScoreReport } from "../score.js";
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
  // Constructs a ScoreReport directly so compareAgainstBaseline tests don't depend on scoreResults math.
  function makeReport(opts: {
    overallAccuracy: number;
    perClaimTypeAccuracy?: Partial<ScoreReport["perClaimTypeAccuracy"]>;
    totalFixtures?: number;
  }): ScoreReport {
    const zero = { correct: 0, total: 0, accuracy: 0 };
    const perClass: ScoreReport["perClaimTypeAccuracy"] = {
      efficacy: zero,
      urgency: zero,
      "safety-claim": zero,
      superiority: zero,
      testimonial: zero,
      "medical-advice": zero,
      diagnosis: zero,
      credentials: zero,
      none: zero,
      ...opts.perClaimTypeAccuracy,
    };
    return {
      totalFixtures: opts.totalFixtures ?? 100,
      overallAccuracy: opts.overallAccuracy,
      perClaimTypeAccuracy: perClass,
      meanLatencyMs: 0,
    };
  }

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

  it("passes when overall accuracy drops by exactly 1pp (boundary, strict >)", () => {
    // baseline.overallAccuracy = 0.9. Construct exactly 0.89.
    // bps comparison: (0.9 - 0.89) * 10000 = 100. Rule is `> 100`, so 100 does not fail.
    const report = makeReport({ overallAccuracy: 0.89 });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(true);
    expect(out.regressions).toHaveLength(0);
  });

  it("fails when overall accuracy drops by more than 1pp", () => {
    const report = makeReport({ overallAccuracy: 0.88 }); // 2pp drop → 200 bps > 100
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/overall/);
  });

  it("fails on per-class drop only (no overall regression)", () => {
    // efficacy baseline 100% (5/5) → current 80% (4/5) → per-class fires.
    // Keep overall above baseline - 1pp so the overall rule does NOT fire.
    const report = makeReport({
      overallAccuracy: 0.95, // above 0.89 floor → overall rule silent
      perClaimTypeAccuracy: {
        efficacy: { correct: 4, total: 5, accuracy: 0.8 },
      },
    });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/efficacy/);
    expect(out.regressions.join("\n")).not.toMatch(/overall/);
  });

  it("fails on overall drop only (no per-class regression)", () => {
    // Baseline has per-class data only for efficacy and urgency. Leave both at 0/0
    // in the current report so per-class checks skip. Drive overall low enough to fail.
    const report = makeReport({ overallAccuracy: 0.85 }); // 5pp drop
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/overall/);
    expect(out.regressions.join("\n")).not.toMatch(/efficacy/);
  });

  it("fails with both per-class and overall regressions reported", () => {
    const report = makeReport({
      overallAccuracy: 0.85,
      perClaimTypeAccuracy: {
        efficacy: { correct: 2, total: 5, accuracy: 0.4 }, // 60pp drop
      },
    });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/efficacy/);
    expect(out.regressions.join("\n")).toMatch(/overall/);
    expect(out.regressions.length).toBeGreaterThanOrEqual(2);
  });
});

describe("countWrong", () => {
  const zero = { correct: 0, total: 0, accuracy: 0 };
  const allZero: ScoreReport["perClaimTypeAccuracy"] = {
    efficacy: zero,
    urgency: zero,
    "safety-claim": zero,
    superiority: zero,
    testimonial: zero,
    "medical-advice": zero,
    diagnosis: zero,
    credentials: zero,
    none: zero,
  };

  it("returns 0 when every class is empty", () => {
    expect(countWrong(allZero)).toBe(0);
  });

  it("sums (total - correct) across all classes", () => {
    expect(
      countWrong({
        ...allZero,
        efficacy: { correct: 4, total: 5, accuracy: 0.8 }, // 1 wrong
        urgency: { correct: 3, total: 5, accuracy: 0.6 }, // 2 wrong
      }),
    ).toBe(3);
  });

  it("skips undefined metrics (partial baseline record)", () => {
    expect(countWrong({ efficacy: { correct: 5, total: 8, accuracy: 0.625 } })).toBe(3);
  });
});
