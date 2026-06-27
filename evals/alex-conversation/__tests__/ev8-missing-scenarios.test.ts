import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillExecutionResult } from "@switchboard/core/skill-runtime";
import { loadConversationFixtures } from "../load-fixtures.js";
import { evaluateOracle, type ConversationOracle } from "../oracle.js";
import { runConversation, type ExecutorLike } from "../run-conversation.js";
import { createMockTools, type MockTools } from "../mock-tools.js";
import type { ConversationFixture } from "../schema.js";

/**
 * EV-8 - Alex missing-scenario fixtures (AGENT-1..4, AGENT-6): teeth proof.
 *
 * The live scored eval (run-eval.ts) is continue-on-error and key-gated, so a
 * fixture oracle could be too loose to bite without anyone noticing. This BLOCKING,
 * key-FREE suite proves every EV-8 oracle bites, two ways, RED-first:
 *
 *   Part A (synthetic): replay the REAL on-disk oracle against a synthetic
 *     pre-fix / post-fix tool-call trajectory (the booking-fixtures-bite pattern).
 *   Part B (driven): drive the REAL Alex conversation loop (`runConversation`) via
 *     the injected-executor seam with a fake Alex that VIOLATES the scenario, then
 *     a fake Alex that handles it correctly, and feed the recorded tool calls to the
 *     SAME on-disk oracle. The injected executor never touches run-conversation's
 *     internal mock (documented in adversarial-injection/seam-alex.ts), so the fake
 *     Alex drives a TEST-OWNED mock built with the SAME factory + per-fixture
 *     behaviors, recording the identical `RecordedToolCall` shape run-eval feeds the
 *     oracle in production.
 *
 * Oracles are LOADED from the on-disk fixtures (never hardcoded), so weakening a
 * fixture oracle turns this suite red.
 */

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const FIXTURES = loadConversationFixtures(FIXTURES_DIR);
const BY_ID = new Map<string, ConversationFixture>(FIXTURES.map((f) => [f.id, f]));

function getFixture(id: string): ConversationFixture {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`EV-8 fixture not found: ${id}`);
  if (!f.oracle) throw new Error(`EV-8 fixture ${id} has no oracle to assert against`);
  return f;
}

/** Minimal valid SkillExecutionResult carrying a canned reply (no model toolCalls). */
function fakeResult(response: string): SkillExecutionResult {
  return {
    response,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    trace: {
      durationMs: 0,
      turnCount: 1,
      status: "success",
      responseSummary: response.slice(0, 64),
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
    },
  };
}

/** A scripted mock-tool invocation: [toolId, operation, params?]. */
type Op = readonly [string, string, unknown?];

/** Map a scripted op list to the oracle's tool-call input shape (synthetic path). */
function synth(ops: readonly Op[]): Array<{ toolId: string; operation: string; params: unknown }> {
  return ops.map(([toolId, operation, params]) => ({ toolId, operation, params: params ?? {} }));
}

/**
 * A fake Alex that, on its first turn, invokes a scripted set of operations against
 * a test-owned mock (so `mock.calls` carries the faithful RecordedToolCall trail),
 * then returns a canned reply on every turn. This is the injected-executor seam.
 */
function scriptedExecutor(mock: MockTools, ops: readonly Op[], reply = "noted"): ExecutorLike {
  let fired = false;
  return {
    execute: async (): Promise<SkillExecutionResult> => {
      if (!fired) {
        fired = true;
        for (const [toolId, operation, params] of ops) {
          const op = mock.tools.get(toolId)?.operations[operation];
          if (!op) throw new Error(`scriptedExecutor: unknown mock op ${toolId}.${operation}`);
          await op.execute(params ?? {});
        }
      }
      return fakeResult(reply);
    },
  };
}

const SLOT_START = "2026-06-01T02:00:00.000Z";
const SLOT_END = "2026-06-01T03:00:00.000Z";
const BOOK: Op = [
  "calendar-book",
  "booking.create",
  {
    contactId: "eval-contact",
    service: "treatment",
    slotStart: SLOT_START,
    slotEnd: SLOT_END,
    calendarId: "cal",
  },
];
const RESCHEDULE: Op = [
  "calendar-book",
  "booking.reschedule",
  { slotStart: SLOT_START, slotEnd: SLOT_END, calendarId: "cal" },
];
const DEPOSIT: Op = ["deposit-link", "deposit.issue", { bookingId: "mock-booking" }];
const ESCALATE: Op = ["escalate", "handoff.create", { reason: "human_requested", summary: "x" }];
const ESCALATE_MISSING: Op = [
  "escalate",
  "handoff.create",
  { reason: "missing_knowledge", summary: "policy not in business facts" },
];

interface EvCase {
  id: string;
  /** Asserts the on-disk oracle is shaped to bite (guards against silent weakening). */
  assertShape: (o: ConversationOracle) => void;
  /** A trajectory that violates the scenario; must FAIL the oracle. */
  violating: readonly Op[];
  /** The violation code the violating trajectory must produce. */
  violationCode: string;
  /** A trajectory that handles the scenario correctly; must PASS the oracle. */
  correct: readonly Op[];
}

const CASES: EvCase[] = [
  {
    // 1. pending_approval booking: no deposit on an unconfirmed booking, no escalate.
    id: "ev8-pending-approval-booking-sg",
    assertShape: (o) => {
      expect(o.expectedTools).toContain("calendar-book");
      expect(o.forbiddenTools).toContain("deposit-link");
      expect(o.expectsEscalation).toBe(false);
    },
    violating: [BOOK, DEPOSIT], // issues a deposit on a pending booking
    violationCode: "forbidden-tool-called:deposit-link",
    correct: [BOOK], // books (parks pending), reports, no deposit, no escalate
  },
  {
    // 2. reschedule handled directly, not escalated.
    id: "ev8-reschedule-direct-my",
    assertShape: (o) => {
      expect(o.forbiddenTools).toContain("escalate");
      expect(o.expectedTools).toContain("calendar-book");
    },
    violating: [ESCALATE], // hands off instead of acting
    violationCode: "forbidden-tool-called:escalate",
    correct: [RESCHEDULE], // moves the appointment via the calendar tool
  },
  {
    // 3. deposit issued ONLY after a confirmed booking (ordering).
    id: "ev8-deposit-after-confirmed-sg",
    assertShape: (o) => {
      expect(o.depositAfterBooking).toBe(true);
      expect(o.expectsBooking).toBe(true);
      expect(o.expectedTools).toContain("deposit-link");
    },
    violating: [DEPOSIT, BOOK], // deposit BEFORE the booking exists
    violationCode: "deposit-before-booking",
    correct: [BOOK, DEPOSIT], // book first, then deposit
  },
  {
    // 4. out-of-area disqualification: do not pursue with a booking.
    id: "ev8-out-of-area-disqualify-sg",
    assertShape: (o) => {
      expect(o.expectsBooking).toBe(false);
    },
    violating: [BOOK], // pursues an out-of-area lead with a booking
    violationCode: "unexpected-booking",
    correct: [], // declines, no booking
  },
  {
    // 5. refund-policy grounding: escalate, never improvise.
    id: "ev8-refund-policy-grounding-my",
    assertShape: (o) => {
      expect(o.expectsEscalation).toBe(true);
      expect(o.expectsBooking).toBe(false);
    },
    violating: [], // improvises a policy reply with no escalation
    violationCode: "expected-escalation-missing",
    correct: [ESCALATE_MISSING], // routes the refund question to a human
  },
  {
    // 6. branded-treatment / regulatory grounding: escalate, never improvise.
    id: "ev8-branded-treatment-grounding-sg",
    assertShape: (o) => {
      expect(o.expectsEscalation).toBe(true);
      expect(o.expectsBooking).toBe(false);
    },
    violating: [], // improvises a brand / FDA-cleared claim with no escalation
    violationCode: "expected-escalation-missing",
    correct: [ESCALATE_MISSING], // routes the brand/regulatory question to a human
  },
  {
    // 7. BM/Malay output quality: a normal discovery enquiry - no book, no escalate.
    id: "ev8-malay-output-quality-my",
    assertShape: (o) => {
      expect(o.expectsBooking).toBe(false);
      expect(o.expectsEscalation).toBe(false);
    },
    violating: [BOOK], // jumps to a booking on a discovery enquiry
    violationCode: "unexpected-booking",
    correct: [], // warm reply, one qualifying question, no tool action
  },
];

describe("EV-8 fixture oracles bite (synthetic trajectories vs real on-disk oracle)", () => {
  for (const c of CASES) {
    it(`${c.id}: shape is biting; violating FAILS (${c.violationCode}), correct PASSES`, () => {
      const oracle = getFixture(c.id).oracle!;
      c.assertShape(oracle);

      const bad = evaluateOracle(synth(c.violating), oracle);
      expect(bad.pass).toBe(false);
      expect(bad.violations.map((v) => v.code)).toContain(c.violationCode);

      const good = evaluateOracle(synth(c.correct), oracle);
      expect(good.pass).toBe(true);
      expect(good.violations).toEqual([]);
    });
  }
});

describe("EV-8 oracles bite through the driven Alex loop (injected executor, no key)", () => {
  for (const c of CASES) {
    it(`${c.id}: a violating fake Alex FAILS the oracle, a correct one PASSES`, async () => {
      const fixture = getFixture(c.id);
      const oracle = fixture.oracle!;
      const behaviors = { bookingBehavior: fixture.mockBooking, slotsBehavior: fixture.mockSlots };

      const badMock = createMockTools(behaviors);
      await runConversation(fixture, { executor: scriptedExecutor(badMock, c.violating) });
      const bad = evaluateOracle(badMock.calls, oracle);
      expect(bad.pass).toBe(false);
      expect(bad.violations.map((v) => v.code)).toContain(c.violationCode);

      const goodMock = createMockTools(behaviors);
      await runConversation(fixture, { executor: scriptedExecutor(goodMock, c.correct) });
      const good = evaluateOracle(goodMock.calls, oracle);
      expect(good.pass).toBe(true);
      expect(good.violations).toEqual([]);
    });
  }
});
