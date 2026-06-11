import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRileyCases } from "../load-fixtures.js";
import { decideForCase } from "../decide.js";
import { RileyCaseSchema } from "../schema.js";

/**
 * DRIFT GUARD (modeled on evals/governance-decision/__tests__/governance-decision.test.ts).
 *
 * The riley matrix is only a real safety net while the fixture set keeps covering
 * the decision space. These tests fail when coverage SILENTLY shrinks — e.g. someone
 * deletes the only `learning_limited` fixture, or a refactor stops producing the
 * `measurement_untrusted` / `insufficient_evidence` abstention surfaces and no fixture
 * notices. Both are exactly the kind of regression a green-but-thin eval would miss.
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cases = loadRileyCases(FIXTURES_DIR);

// The full input dimensions the schema can express. Sourced from the schema enums so
// adding a new tier/state to the schema automatically tightens this guard (the loop
// below will demand a fixture for it).
const ECONOMIC_TIERS = RileyCaseSchema.shape.economicTier.options;
const LEARNING_STATES = RileyCaseSchema.shape.learningState.options;

describe("riley fixture-coverage drift guard", () => {
  it("every economicTier value appears in at least one fixture", () => {
    const seen = new Set(cases.map((c) => c.economicTier));
    for (const tier of ECONOMIC_TIERS) {
      expect(seen.has(tier)).toBe(true);
    }
  });

  it("every learningState value appears in at least one fixture", () => {
    const seen = new Set(cases.map((c) => c.learningState));
    for (const state of LEARNING_STATES) {
      expect(seen.has(state)).toBe(true);
    }
  });

  it("both measurementTrusted true and false appear in at least one fixture", () => {
    const seen = new Set(cases.map((c) => c.measurementTrusted ?? true));
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
  });

  it("the key advisory + abstention outcomes are each observed at least once", () => {
    // Collect the UNION of everything the engine produces across all fixtures, run
    // through the REAL decide seam (no hand-listed expectations — the engine decides).
    const actions = new Set<string>();
    const watchPatterns = new Set<string>();
    let insightSeen = false;
    for (const c of cases) {
      const d = decideForCase(c);
      d.actions.forEach((a) => actions.add(a));
      d.watchPatterns.forEach((w) => watchPatterns.add(w));
      if (d.hasInsight) insightSeen = true;
    }

    // Direct actions: Riley both ACTS (add_creative + pause as the durable-breach pair)
    // — losing either from the fixture set means the act-path is no longer exercised.
    expect(actions.has("add_creative")).toBe(true);
    expect(actions.has("pause")).toBe(true);

    // Abstention surfaces (the Phase-A floor's whole point). If any of these stops being
    // produced by the covered fixtures, the corresponding abstention is no longer guarded.
    expect(watchPatterns.has("insufficient_evidence")).toBe(true); // Gate 2 thin-data floor
    expect(watchPatterns.has("measurement_untrusted")).toBe(true); // Gate 1 denominator-trust hold
    expect(watchPatterns.has("in_learning_phase")).toBe(true); // V2 reset-class learning lockout
    expect(watchPatterns.has("burn")).toBe(true); // D1-1 sub-durable zero-conversion visibility

    // The stable abstention floor: a low/healthy-signal account falls through to a
    // non-destructive insight rather than over-optimizing.
    expect(insightSeen).toBe(true);
  });
});
