import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTrajectoryCases } from "../load-fixtures.js";
import { gradeTrajectory } from "../grade.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cases = loadTrajectoryCases(FIXTURES_DIR);

/**
 * Grades the COMMITTED golden fixtures through the real grader and enforces each fixture's declared
 * verdict + exact violation-kind set. This is the anti-self-confirm gate: a fixture cannot "pass by
 * construction" — a violating fixture MUST produce exactly the violation kinds it declares, and a
 * clean fixture MUST produce none. Mirrors the runner so the vitest suite and the CLI agree.
 */
describe("trajectory-grading fixtures (graded by the real grader)", () => {
  it("loads a non-empty set with BOTH passing and failing cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.some((c) => c.expectedVerdict === "pass")).toBe(true);
    expect(cases.some((c) => c.expectedVerdict === "fail")).toBe(true);
  });

  it("the violating fixtures cover all four violation kinds", () => {
    const declared = new Set(cases.flatMap((c) => c.expectedViolationKinds ?? []));
    expect([...declared].sort()).toEqual([
      "approval-bypassed",
      "argument-invalid",
      "malformed-record",
      "tool-sequence-mismatch",
    ]);
  });

  it.each(cases.map((c) => [c.id, c] as const))(
    "%s grades to its declared verdict + violation kinds",
    (_id, c) => {
      const result = gradeTrajectory({
        trustLevel: c.trustLevel,
        expected: c.expected,
        trajectory: c.trajectory,
      });
      expect(result.ok ? "pass" : "fail").toBe(c.expectedVerdict);
      if (c.expectedViolationKinds) {
        const actual = [...new Set(result.violations.map((v) => v.kind))].sort();
        expect(actual).toEqual([...new Set(c.expectedViolationKinds)].sort());
      }
    },
  );
});
