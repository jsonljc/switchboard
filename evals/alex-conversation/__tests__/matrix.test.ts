import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConversationFixtures } from "../load-fixtures.js";
import { ConversationStageSchema } from "../schema.js";
import { ConversationOracleSchema } from "../oracle.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

// `loadConversationFixtures` already schema-validates every row and throws on a
// duplicate id, so a successful load is itself a structural guarantee. The
// assertions below pin the *coverage* of the generated golden + edge suite.
const fixtures = loadConversationFixtures(FIXTURES_DIR);

function countWhere(pred: (f: (typeof fixtures)[number]) => boolean): number {
  return fixtures.filter(pred).length;
}

describe("alex-conversation golden-scenario matrix coverage", () => {
  it("loads the full suite within sane bounds", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(60);
    expect(fixtures.length).toBeLessThanOrEqual(95);
  });

  it("ids are unique (load would have thrown otherwise)", () => {
    const ids = fixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every fixture starts on a lead turn and ends on an alex turn", () => {
    for (const f of fixtures) {
      expect(f.turns[0]?.role).toBe("lead");
      expect(f.turns[f.turns.length - 1]?.role).toBe("alex");
    }
  });

  it("covers both locales with depth", () => {
    expect(countWhere((f) => f.locale === "sg")).toBeGreaterThanOrEqual(8);
    expect(countWhere((f) => f.locale === "my")).toBeGreaterThanOrEqual(8);
  });

  it("every stage value has at least 3 scenarios", () => {
    for (const stage of ConversationStageSchema.options) {
      const n = countWhere((f) => f.stage === stage);
      expect(n, `stage "${stage}" has only ${n} scenarios`).toBeGreaterThanOrEqual(3);
    }
  });

  it("includes full-arc golden conversations", () => {
    const arcs = fixtures.filter((f) => f.stage === "full-arc");
    expect(arcs.length).toBeGreaterThanOrEqual(6);
    // Full-arc fixtures are genuinely multi-turn.
    for (const arc of arcs) expect(arc.turns.length).toBeGreaterThanOrEqual(4);
  });

  it("exercises escalation and do-not-book oracles", () => {
    expect(countWhere((f) => f.oracle?.expectsEscalation === true)).toBeGreaterThanOrEqual(6);
    expect(countWhere((f) => f.oracle?.expectsBooking === false)).toBeGreaterThanOrEqual(10);
    expect(countWhere((f) => f.oracle?.expectsBooking === true)).toBeGreaterThanOrEqual(4);
  });

  it("most fixtures carry a machine-checkable oracle, and every oracle is well-formed", () => {
    const withOracle = fixtures.filter((f) => f.oracle !== undefined);
    expect(withOracle.length).toBeGreaterThanOrEqual(50);
    for (const f of withOracle) {
      // Re-validating proves the refinements held end-to-end through the loader.
      expect(ConversationOracleSchema.safeParse(f.oracle).success).toBe(true);
    }
  });
});
