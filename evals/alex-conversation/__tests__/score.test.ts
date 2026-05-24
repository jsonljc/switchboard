import { describe, it, expect } from "vitest";
import { compareAgainstBaseline, summarizeResults } from "../score.js";
import type { ScenarioResult } from "../score.js";
import type { Baseline } from "../schema.js";

// ---------------------------------------------------------------------------
// Fixtures — shared baseline and result builders
// ---------------------------------------------------------------------------

/**
 * Minimal valid baseline. All tests derive from this using spread.
 */
function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    version: 1,
    generatedAt: "2026-05-24T00:00:00.000Z",
    skillContentHash: "abc123",
    judgeRubricVersion: "judge-medspa@1.0.0",
    judgeScoreTolerance: 1,
    scenarios: [],
    ...overrides,
  };
}

/**
 * Build a passing ScenarioResult that matches the supplied baseline entry's id.
 */
function makeResult(id: string, overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id,
    deterministicPass: true,
    judgeScore: 4,
    requiredBehaviorsMet: ["acknowledged price sensitivity", "consultation positioned as low-risk"],
    violations: [],
    semanticHardRulePass: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// compareAgainstBaseline — core regression rules
// ---------------------------------------------------------------------------

describe("compareAgainstBaseline", () => {
  // -------------------------------------------------------------------------
  // Rule 1: deterministicPass regression
  // -------------------------------------------------------------------------

  it("blocks when deterministicPass flips true → false", () => {
    const baseline = makeBaseline({
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: ["acknowledged price sensitivity"],
          violations: [],
        },
      ],
    });

    const current = [
      makeResult("sg-price-objection", {
        deterministicPass: false,
        violations: ["claim:efficacy"],
      }),
    ];

    const { passed, regressions } = compareAgainstBaseline(current, baseline);

    expect(passed).toBe(false);
    expect(
      regressions.some((r) => r.includes("[regression]") && r.includes("deterministicPass")),
    ).toBe(true);
  });

  it("does NOT block when deterministicPass stays false → false (already failing in baseline)", () => {
    // A scenario that was already failing in the baseline flipping false→false
    // is not a new regression.
    const baseline = makeBaseline({
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: false,
          judgeScore: 3,
          requiredBehaviorsMet: [],
          violations: ["claim:efficacy"],
        },
      ],
    });

    const current = [
      makeResult("sg-price-objection", {
        deterministicPass: false,
        violations: ["claim:efficacy"],
        judgeScore: 3,
      }),
    ];

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  it("does NOT block when deterministicPass improves false → true", () => {
    const baseline = makeBaseline({
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: false,
          judgeScore: 3,
          requiredBehaviorsMet: [],
          violations: ["claim:efficacy"],
        },
      ],
    });

    const current = [makeResult("sg-price-objection", { deterministicPass: true, judgeScore: 3 })];

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Rule 2: semanticHardRulePass violation
  // -------------------------------------------------------------------------

  it("blocks when semanticHardRulePass is false in current result", () => {
    const baseline = makeBaseline({
      scenarios: [
        {
          id: "my-booking-pressure",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: ["no booking pressure"],
          violations: [],
        },
      ],
    });

    const current = [
      makeResult("my-booking-pressure", {
        semanticHardRulePass: false,
        violations: ["guarantees results"],
      }),
    ];

    const { passed, regressions } = compareAgainstBaseline(current, baseline);

    expect(passed).toBe(false);
    expect(
      regressions.some((r) => r.includes("[regression]") && r.includes("semanticHardRulePass")),
    ).toBe(true);
  });

  it("does NOT block when semanticHardRulePass is true", () => {
    const baseline = makeBaseline({
      scenarios: [
        {
          id: "my-booking-pressure",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [makeResult("my-booking-pressure", { semanticHardRulePass: true })];

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  it("does NOT block when semanticHardRulePass is undefined (judge not run)", () => {
    const baseline = makeBaseline({
      scenarios: [
        {
          id: "sg-cold-open",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [makeResult("sg-cold-open", { semanticHardRulePass: undefined })];

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Rule 3: judge score drop
  // -------------------------------------------------------------------------

  it("blocks when judgeScore drops beyond tolerance", () => {
    // Baseline: 4.0, tolerance: 1.0 → regression if current < 3.0
    const baseline = makeBaseline({
      judgeScoreTolerance: 1,
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [makeResult("sg-price-objection", { judgeScore: 2 })];
    // drop = 4 - 2 = 2, which exceeds tolerance 1

    const { passed, regressions } = compareAgainstBaseline(current, baseline);

    expect(passed).toBe(false);
    expect(regressions.some((r) => r.includes("[regression]") && r.includes("judgeScore"))).toBe(
      true,
    );
  });

  it("does NOT block when judgeScore drop is exactly at tolerance (not beyond)", () => {
    // Drop = tolerance (1.0): equal is NOT a regression — only strictly greater.
    const baseline = makeBaseline({
      judgeScoreTolerance: 1,
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [makeResult("sg-price-objection", { judgeScore: 3 })];
    // drop = 4 - 3 = 1.0, which equals tolerance (not strictly greater)

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  it("does NOT block when judgeScore drop is within tolerance", () => {
    const baseline = makeBaseline({
      judgeScoreTolerance: 1,
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [makeResult("sg-price-objection", { judgeScore: 3.5 })];
    // drop = 0.5, within tolerance 1.0

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  it("does NOT block when judgeScore improves or stays the same", () => {
    const baseline = makeBaseline({
      judgeScoreTolerance: 1,
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 3,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [makeResult("sg-price-objection", { judgeScore: 5 })];

    const { passed } = compareAgainstBaseline(current, baseline);
    expect(passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scenarios not in baseline (new)
  // -------------------------------------------------------------------------

  it("does NOT block on scenarios absent from the baseline (new scenarios)", () => {
    const baseline = makeBaseline({ scenarios: [] });

    const current = [makeResult("brand-new-scenario", { deterministicPass: true, judgeScore: 5 })];

    const { passed, regressions } = compareAgainstBaseline(current, baseline);

    // Not a regression — but an info note is still expected.
    expect(passed).toBe(true);
    expect(regressions.some((r) => r.includes("[info]") && r.includes("brand-new-scenario"))).toBe(
      true,
    );
  });

  // -------------------------------------------------------------------------
  // Passes cleanly
  // -------------------------------------------------------------------------

  it("passes when current matches baseline exactly", () => {
    const baseline = makeBaseline({
      judgeScoreTolerance: 1,
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: ["acknowledged price sensitivity"],
          violations: [],
        },
        {
          id: "my-booking-pressure",
          deterministicPass: true,
          judgeScore: 5,
          requiredBehaviorsMet: ["no booking pressure"],
          violations: [],
        },
      ],
    });

    const current = [
      makeResult("sg-price-objection", {
        deterministicPass: true,
        judgeScore: 4,
        semanticHardRulePass: true,
      }),
      makeResult("my-booking-pressure", {
        deterministicPass: true,
        judgeScore: 5,
        semanticHardRulePass: true,
      }),
    ];

    const { passed, regressions } = compareAgainstBaseline(current, baseline);

    expect(passed).toBe(true);
    expect(regressions.filter((r) => r.startsWith("[regression]"))).toHaveLength(0);
  });

  it("flags multiple regressions in a single run", () => {
    const baseline = makeBaseline({
      judgeScoreTolerance: 1,
      scenarios: [
        {
          id: "sg-price-objection",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
        {
          id: "my-cold-open",
          deterministicPass: true,
          judgeScore: 4,
          requiredBehaviorsMet: [],
          violations: [],
        },
      ],
    });

    const current = [
      // Rule 1 regression: deterministic flip
      makeResult("sg-price-objection", {
        deterministicPass: false,
        violations: ["claim:efficacy"],
      }),
      // Rule 3 regression: score drop
      makeResult("my-cold-open", { judgeScore: 2 }),
    ];

    const { passed, regressions } = compareAgainstBaseline(current, baseline);

    expect(passed).toBe(false);
    const actual = regressions.filter((r) => r.startsWith("[regression]"));
    expect(actual).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// summarizeResults
// ---------------------------------------------------------------------------

describe("summarizeResults", () => {
  it("returns a non-empty string for a non-empty result set", () => {
    const results: ScenarioResult[] = [
      makeResult("sg-price-objection", {
        deterministicPass: true,
        judgeScore: 4.5,
        semanticHardRulePass: true,
        violations: [],
      }),
      makeResult("my-cold-open", {
        deterministicPass: false,
        judgeScore: 2,
        semanticHardRulePass: false,
        violations: ["claim:efficacy"],
      }),
    ];

    const output = summarizeResults(results);
    expect(output).toContain("sg-price-objection");
    expect(output).toContain("my-cold-open");
    // deterministicPass status should be reflected
    expect(output).toContain("pass");
    expect(output).toContain("FAIL");
  });

  it("returns a placeholder string for an empty result set", () => {
    expect(summarizeResults([])).toBe("(no results)");
  });
});
