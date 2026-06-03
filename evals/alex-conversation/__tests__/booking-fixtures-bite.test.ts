import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOracle, type ConversationOracle } from "../oracle.js";
import { ConversationFixtureSchema } from "../schema.js";

/**
 * Regression net for the PR-B "Booking Lifecycle Integrity" fixtures.
 *
 * The live scored eval (run-eval.ts) is continue-on-error and credit-gated, so a
 * fixture's oracle could be too loose to "bite" without anyone noticing. This
 * BLOCKING vitest proves the NEW (and strengthened) oracles bite by replaying the
 * REAL fixture oracles against synthetic pre-fix / post-fix tool-call trajectories:
 *
 *   - reschedule / cancel / governed-close:  forbiddenTools:[escalate] +
 *     expectedTools:[calendar-book].  Pre-fix (Alex escalates instead of acting)
 *     ⇒ FAIL.  Post-fix (Alex drives calendar-book, no escalate) ⇒ PASS.
 *   - slot-taken:  expectsEscalation:false + expectedTools:[calendar-book].
 *     Pre-fix (Alex escalates after the failure) ⇒ FAIL (unexpected-escalation).
 *     Post-fix (Alex re-offers via calendar-book) ⇒ PASS.
 *
 * The oracles are LOADED from the on-disk fixtures (never hardcoded) so this test
 * fails if anyone weakens a fixture oracle.
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** Parse a jsonl file and return the (schema-validated) fixture with the given id. */
function loadOracle(file: string, id: string): ConversationOracle {
  const lines = readFileSync(join(FIXTURES_DIR, file), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  for (const line of lines) {
    const fixture = ConversationFixtureSchema.parse(JSON.parse(line));
    if (fixture.id === id) {
      if (!fixture.oracle) {
        throw new Error(`fixture ${id} in ${file} has no oracle to assert against`);
      }
      return fixture.oracle;
    }
  }
  throw new Error(`fixture ${id} not found in ${file}`);
}

/** Build a tool-call list from bare tool ids (matches the oracle's input shape). */
function calls(...ids: string[]): Array<{ toolId: string }> {
  return ids.map((toolId) => ({ toolId }));
}

describe("new booking fixtures bite deterministically (real oracles, synthetic trajectories)", () => {
  // forbidden-escalate + expected-calendar-book oracles: escalate must fail,
  // calendar-book must pass.
  const forbidEscalateCases: Array<{ id: string; file: string }> = [
    { id: "post-sg-hifu-reschedule", file: "gen-post-booking.jsonl" },
    { id: "post-sg-filler-cancel", file: "gen-post-booking.jsonl" },
    { id: "book-sg-governed-close-pending", file: "gen-booking.jsonl" },
  ];

  for (const { id, file } of forbidEscalateCases) {
    it(`${id}: escalating FAILS the oracle, driving calendar-book PASSES`, () => {
      const oracle = loadOracle(file, id);
      // Sanity: the oracle is actually shaped to bite (not a no-op block).
      expect(oracle.forbiddenTools).toContain("escalate");
      expect(oracle.expectedTools).toContain("calendar-book");

      // PRE-FIX: Alex escalates instead of acting on the booking lifecycle.
      const preFix = evaluateOracle(calls("escalate"), oracle);
      expect(preFix.pass).toBe(false);
      expect(preFix.violations.map((v) => v.code)).toContain("forbidden-tool-called:escalate");

      // POST-FIX: Alex uses calendar-book (reschedule/cancel/create), no escalate.
      const postFix = evaluateOracle(calls("calendar-book"), oracle);
      expect(postFix.pass).toBe(true);
      expect(postFix.violations).toEqual([]);
    });
  }

  it("err-sg-slot-just-taken-reoffer: escalating after the failure FAILS, re-offering PASSES", () => {
    const oracle = loadOracle("gen-tool-error.jsonl", "err-sg-slot-just-taken-reoffer");
    // Sanity: this oracle bites via expectsEscalation:false, not forbiddenTools.
    expect(oracle.expectsEscalation).toBe(false);
    expect(oracle.expectedTools).toContain("calendar-book");

    // PRE-FIX: Alex attempts the booking (calendar-book) then escalates on the
    // SLOT_TAKEN failure — the ONLY violation is the unexpected escalation, which
    // proves the escalation specifically is what bites.
    const preFix = evaluateOracle(calls("escalate", "calendar-book"), oracle);
    expect(preFix.pass).toBe(false);
    expect(preFix.violations.map((v) => v.code)).toEqual(["unexpected-escalation"]);

    // POST-FIX: Alex re-offers the next available times via calendar-book only.
    const postFix = evaluateOracle(calls("calendar-book"), oracle);
    expect(postFix.pass).toBe(true);
    expect(postFix.violations).toEqual([]);
  });
});
