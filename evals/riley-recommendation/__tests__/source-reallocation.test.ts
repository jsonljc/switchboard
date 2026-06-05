import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSourceReallocationCases,
  decideSourceReallocationForCase,
} from "../source-reallocation-eval.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "source-reallocation",
);

describe("Riley source-reallocation eval matrix", () => {
  const cases = loadSourceReallocationCases(FIXTURES_DIR);

  it("covers the reallocate path and every abstention reason (drift guard)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
    const outcomes = new Set(cases.map((c) => c.expectedOutcome));
    expect(outcomes.has("shift_budget_to_source")).toBe(true);
    expect(outcomes.has("watch")).toBe(true);
    expect(outcomes.has("none")).toBe(true);
    const watchPatterns = new Set(
      cases.flatMap((c) => (c.expectedWatchPattern ? [c.expectedWatchPattern] : [])),
    );
    expect(watchPatterns.has("insufficient_evidence")).toBe(true);
    expect(watchPatterns.has("measurement_untrusted")).toBe(true);
  });

  for (const c of cases) {
    it(`${c.id} -> ${c.expectedOutcome}`, async () => {
      const decision = await decideSourceReallocationForCase(c);
      expect(decision.outcome).toBe(c.expectedOutcome);
      if (c.expectedWatchPattern) {
        expect(decision.watchPattern).toBe(c.expectedWatchPattern);
      }
    });
  }
});
