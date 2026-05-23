import { describe, it, expect } from "vitest";
import { scoreResults, compareAgainstBaseline, countWrong, type ScoreReport } from "../score.js";
import { ClaimTypeEnum } from "../schema.js";
import type { InvocationResult } from "../invoke-classifier.js";
import type { Baseline, ClaimTypeLabel } from "../schema.js";

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
  // Builds a ScoreReport from per-class {correct,total} counts and DERIVES overallAccuracy
  // + totalFixtures from those counts, so a test can never set an overall drop that
  // disagrees with the per-class wrong-counts the overall rule now reads.
  function makeReport(
    counts: Partial<Record<ClaimTypeLabel, { correct: number; total: number }>>,
  ): ScoreReport {
    const perClass = {} as ScoreReport["perClaimTypeAccuracy"];
    let totalCorrect = 0;
    let totalCount = 0;
    for (const type of ClaimTypeEnum.options) {
      const provided = counts[type];
      const correct = provided?.correct ?? 0;
      const total = provided?.total ?? 0;
      perClass[type] = { correct, total, accuracy: total === 0 ? 0 : correct / total };
      totalCorrect += correct;
      totalCount += total;
    }
    return {
      totalFixtures: totalCount,
      overallAccuracy: totalCount === 0 ? 0 : totalCorrect / totalCount,
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

  it("per-class: a single-fixture flip on a class does NOT fire (suppressed)", () => {
    // efficacy 5/5 -> 4/5 is a 20pp drop but only +1 wrong; additionalWrong (1) < 2.
    // urgency held at baseline (4/5). Overall additionalWrong = 1 (< 3) so overall is silent too.
    const report = makeReport({
      efficacy: { correct: 4, total: 5 },
      urgency: { correct: 4, total: 5 },
    });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(true);
    expect(out.regressions).toHaveLength(0);
  });

  it("per-class: a two-fixture drop on a class fires", () => {
    // efficacy 5/5 -> 3/5: drop 40pp and +2 wrong; additionalWrong (2) >= 2 -> fires.
    const report = makeReport({
      efficacy: { correct: 3, total: 5 },
      urgency: { correct: 4, total: 5 },
    });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/efficacy/);
    expect(out.regressions.join("\n")).not.toMatch(/overall/);
  });

  it("overall: a two-fixture cross-class swing does NOT fire (suppressed)", () => {
    // efficacy +1 wrong, urgency +1 wrong => no class reaches additionalWrong 2,
    // and overall additionalWrong = 2 (< 3). Overall drop is 20pp but is suppressed.
    const report = makeReport({
      efficacy: { correct: 4, total: 5 },
      urgency: { correct: 3, total: 5 },
    });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(true);
    expect(out.regressions).toHaveLength(0);
  });

  it("overall: a three-fixture cross-class swing fires (overall only)", () => {
    // efficacy +1, urgency +1, safety-claim +1 (baseline 0/0 so per-class skips it).
    // No class reaches additionalWrong 2; overall additionalWrong = 3 (>= 3) -> overall fires.
    const report = makeReport({
      efficacy: { correct: 4, total: 5 },
      urgency: { correct: 3, total: 5 },
      "safety-claim": { correct: 0, total: 1 },
    });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(false);
    expect(out.regressions.join("\n")).toMatch(/overall/);
    expect(out.regressions.join("\n")).not.toMatch(/efficacy/);
    expect(out.regressions.join("\n")).not.toMatch(/urgency/);
  });

  it("overall: an exactly-1pp drop never fires even when many fixtures are wrong (strict >)", () => {
    // 89/100 overall = exactly 1pp below baseline 0.9 -> overallDropBps == 100, not > 100.
    // All wrong fixtures land in `none` (baseline 0/0 -> per-class skips). additionalWrong is
    // large but the drop gate is false, so nothing fires.
    const report = makeReport({ none: { correct: 89, total: 100 } });
    const out = compareAgainstBaseline(report, baseline);
    expect(out.passed).toBe(true);
    expect(out.regressions).toHaveLength(0);
  });

  it("fires both per-class and overall when a real broad regression occurs", () => {
    // efficacy 2/5: drop 60pp, +3 wrong -> per-class fires. urgency 3/5: +1 wrong.
    // overall additionalWrong = 3 + 1 = 4 (>= 3) and overall drop is large -> overall fires.
    const report = makeReport({
      efficacy: { correct: 2, total: 5 },
      urgency: { correct: 3, total: 5 },
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
        efficacy: { correct: 4, total: 5 }, // 1 wrong
        urgency: { correct: 3, total: 5 }, // 2 wrong
      }),
    ).toBe(3);
  });

  it("skips undefined metrics (partial baseline record)", () => {
    expect(countWrong({ efficacy: { correct: 5, total: 8 } })).toBe(3);
  });
});
