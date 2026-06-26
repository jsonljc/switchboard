import { describe, expect, it } from "vitest";
import { compareAgainstBaseline, summarizeResults, type MiraScenarioResult } from "../score.js";
import type { MiraBaseline } from "../schema.js";

const baseline: MiraBaseline = {
  version: 1,
  generatedAt: "2026-06-22T00:00:00.000Z",
  corpusHash: "deadbeef",
  judgeRubricVersion: "mira-compose-judge@1.0.0",
  judgeScoreTolerance: 1.0,
  scenarios: [
    { id: "s1", deterministicPass: true, decision: "propose", judgeScore: 4, violations: [] },
  ],
};

const clean: MiraScenarioResult = {
  id: "s1",
  deterministicPass: true,
  decision: "propose",
  judgeScore: 4,
  violations: [],
};

describe("compareAgainstBaseline", () => {
  it("passes when nothing regressed", () => {
    expect(compareAgainstBaseline([clean], baseline).passed).toBe(true);
  });

  it("flags a deterministicPass flip true→false as a regression", () => {
    const r = compareAgainstBaseline(
      [{ ...clean, deterministicPass: false, violations: ["shape-invalid"] }],
      baseline,
    );
    expect(r.passed).toBe(false);
    expect(
      r.regressions.some((x) => x.startsWith("[regression]") && x.includes("deterministicPass")),
    ).toBe(true);
  });

  it("flags a judgeScore drop beyond tolerance", () => {
    const r = compareAgainstBaseline([{ ...clean, judgeScore: 2 }], baseline);
    expect(r.passed).toBe(false);
  });

  it("does NOT flag a judgeScore drop within tolerance", () => {
    expect(compareAgainstBaseline([{ ...clean, judgeScore: 3.2 }], baseline).passed).toBe(true);
  });

  it("notes a new scenario without failing the run", () => {
    const r = compareAgainstBaseline(
      [{ id: "s2", deterministicPass: true, decision: "abstain", judgeScore: 5, violations: [] }],
      baseline,
    );
    expect(r.passed).toBe(true);
    expect(r.regressions.some((x) => x.includes("no baseline"))).toBe(true);
  });
});

describe("summarizeResults", () => {
  it("renders a table carrying the id and decision", () => {
    const s = summarizeResults([clean]);
    expect(s).toContain("s1");
    expect(s).toContain("propose");
  });

  it("handles an empty result set", () => {
    expect(summarizeResults([])).toBe("(no results)");
  });
});
