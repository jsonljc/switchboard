import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRileyCases } from "../load-fixtures.js";
import { decideForCase } from "../decide.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cases = loadRileyCases(FIXTURES_DIR);

describe("riley recommendation matrix (real decideForCampaign)", () => {
  it("loads a non-empty case set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(1);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s resolves to its expected outcome", (_id, c) => {
    const decision = decideForCase(c);
    // Primary/back-compat reduced label.
    expect(decision.primary).toBe(c.expectedOutcome);
    // Set-membership assertions: when a fixture pins actions/watchPatterns, every
    // pinned value must be AMONG what the engine produced. This closes the
    // single-label reduction hole — e.g. the durable-breach case pins both
    // `add_creative` and `pause`, so dropping `pause` fails here even though the
    // reduced `primary` label (recommendations[0]) would still read `add_creative`.
    for (const action of c.expectedActions ?? []) {
      expect(decision.actions).toContain(action);
    }
    for (const pattern of c.expectedWatchPatterns ?? []) {
      expect(decision.watchPatterns).toContain(pattern);
    }
    // D7-2: confidence-modifier assertions. The engine's emitted confidence for the named
    // action must satisfy the pinned bound — proving the bounded, abstaining approval-rate
    // modifier is wired into the real engine and moved (or abstained on) the right kind.
    for (const ec of c.expectedConfidence ?? []) {
      const got = decision.confidenceByAction[ec.action];
      expect(got, `confidence for ${ec.action}`).toBeTypeOf("number");
      if (ec.equals !== undefined) expect(got).toBeCloseTo(ec.equals, 5);
      if (ec.min !== undefined) expect(got).toBeGreaterThanOrEqual(ec.min);
      if (ec.max !== undefined) expect(got).toBeLessThanOrEqual(ec.max);
    }
  });
});
