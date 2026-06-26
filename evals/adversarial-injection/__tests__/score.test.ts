import { describe, it, expect } from "vitest";
import {
  compareAgainstBaseline,
  summarizeResults,
  type InjectionScenarioResult,
} from "../score.js";
import type { InjectionBaseline } from "../schema.js";

const baseline: InjectionBaseline = {
  version: 1,
  generatedAt: "2026-06-26T00:00:00.000Z",
  corpusHash: "abc1230000000000",
  judgeRubricVersion: "injection-judge@1.0.0",
  judgeScoreTolerance: 1.0,
  scenarios: [
    { id: "a", deterministicPass: true, judgeScore: 5, violations: [] },
    { id: "b", deterministicPass: true, judgeScore: 4, violations: [] },
  ],
};

const res = (over: Partial<InjectionScenarioResult> & { id: string }): InjectionScenarioResult => ({
  deterministicPass: true,
  resistanceScore: 5,
  violations: [],
  ...over,
});

describe("compareAgainstBaseline", () => {
  it("passes when nothing regressed", () => {
    const r = compareAgainstBaseline(
      [res({ id: "a" }), res({ id: "b", resistanceScore: 4 })],
      baseline,
    );
    expect(r.passed).toBe(true);
  });

  it("flags a deterministicPass flip true→false (a new vulnerability)", () => {
    const r = compareAgainstBaseline(
      [res({ id: "a", deterministicPass: false, violations: ["prompt-leak:Bucket A"] })],
      baseline,
    );
    expect(r.passed).toBe(false);
    expect(r.regressions.some((x) => x.includes("deterministicPass"))).toBe(true);
  });

  it("flags a resistance-score drop beyond tolerance", () => {
    const r = compareAgainstBaseline([res({ id: "a", resistanceScore: 3 })], baseline);
    expect(r.passed).toBe(false);
  });

  it("does not flag a within-tolerance score dip", () => {
    const r = compareAgainstBaseline([res({ id: "a", resistanceScore: 4.2 })], baseline);
    expect(r.passed).toBe(true);
  });

  it("skips a new scenario absent from the baseline (info only)", () => {
    const r = compareAgainstBaseline([res({ id: "brand-new" })], baseline);
    expect(r.passed).toBe(true);
    expect(r.regressions.some((x) => x.includes("no baseline"))).toBe(true);
  });
});

describe("summarizeResults", () => {
  it("renders a row per scenario with a FAIL marker on a deterministic failure", () => {
    const s = summarizeResults([
      res({ id: "a" }),
      res({ id: "b", deterministicPass: false, violations: ["crash"] }),
    ]);
    expect(s).toContain("a");
    expect(s).toContain("FAIL");
    expect(s).toContain("crash");
  });
});
