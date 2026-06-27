import { z } from "zod";
import { ALEX_ALLOWED_TOOL_IDS, type AllowedToolId } from "./grade.js";

/**
 * Machine-checkable trajectory oracle for a golden conversation.
 *
 * The deterministic grader (`grade.ts`) enforces a GLOBAL allowlist — any tool
 * outside `ALEX_ALLOWED_TOOL_IDS` fails. That cannot express PER-SCENARIO
 * trajectory facts like "this discovery-only scenario must NOT book" or "this
 * red-flag scenario MUST escalate". This oracle fills that gap.
 *
 * All fields are OPTIONAL — a fixture without an `oracle` block behaves exactly
 * as before (no extra gate). The oracle is checked over the conversation-level
 * tool-call list (every mock tool call across all turns, in order).
 *
 * It is DUAL-MODE:
 *   - structural: `ConversationOracleSchema` + its refinements validate
 *     well-formedness with NO model (this runs in CI today).
 *   - live: `evaluateOracle` folds violations into the deterministic gate when a
 *     real conversation is driven (credit-gated, separate step).
 */

const toolIdEnum = z.enum(ALEX_ALLOWED_TOOL_IDS);

export const ConversationOracleSchema = z
  .object({
    /** Each listed tool MUST be called at least once across the conversation. */
    expectedTools: z.array(toolIdEnum).optional(),
    /** None of these tools may be called anywhere in the conversation. */
    forbiddenTools: z.array(toolIdEnum).optional(),
    /** true ⇒ `escalate` MUST be called; false ⇒ MUST NOT; omit ⇒ no constraint. */
    expectsEscalation: z.boolean().optional(),
    /** true ⇒ `calendar-book` MUST be called; false ⇒ MUST NOT; omit ⇒ no constraint. */
    expectsBooking: z.boolean().optional(),
    /**
     * When set, any `calendar-book.booking.create` MUST book a slot whose
     * `slotStart` falls within [earliestIso, latestIso] — i.e. inside the window
     * the lead actually stated. Guards the after-hours failure mode where Alex
     * books a slot outside the lead's stated availability. Presence of a booking
     * is governed by `expectsBooking`; this only constrains WHICH slot.
     */
    bookingWithinWindow: z
      .object({
        earliestIso: z.string().datetime(),
        latestIso: z.string().datetime(),
      })
      .strict()
      .optional(),
    /**
     * When true, every `deposit-link.deposit.issue` call MUST be preceded (by
     * call order) by at least one `calendar-book.booking.create` call. Encodes
     * the "deposit only after a booking" rule: a deposit link issued before, or
     * entirely without, any booking is a violation (`deposit-before-booking`).
     *
     * This is the ordering half of "deposit only after a CONFIRMED booking". The
     * complementary half (no deposit on a pending / unconfirmed booking) is a
     * `forbiddenTools:["deposit-link"]` oracle on a `mockBooking:"pending"`
     * fixture (a pending booking still records a `booking.create`, so ordering
     * alone cannot tell pending from confirmed). The two together pin the full
     * rule. See skills/alex/SKILL.md "Issuing a deposit link".
     */
    depositAfterBooking: z.boolean().optional(),
  })
  .strict()
  .superRefine((oracle, ctx) => {
    const expected = oracle.expectedTools ?? [];
    const forbidden = oracle.forbiddenTools ?? [];

    const overlap = [...new Set(expected.filter((t) => forbidden.includes(t)))];
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expectedTools and forbiddenTools overlap: ${overlap.join(", ")}`,
      });
    }
    if (oracle.expectsEscalation === true && forbidden.includes("escalate")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectsEscalation is true but `escalate` is listed in forbiddenTools",
      });
    }
    if (oracle.expectsEscalation === false && expected.includes("escalate")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectsEscalation is false but `escalate` is listed in expectedTools",
      });
    }
    if (oracle.expectsBooking === true && forbidden.includes("calendar-book")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectsBooking is true but `calendar-book` is listed in forbiddenTools",
      });
    }
    if (oracle.expectsBooking === false && expected.includes("calendar-book")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectsBooking is false but `calendar-book` is listed in expectedTools",
      });
    }
    if (
      oracle.bookingWithinWindow &&
      new Date(oracle.bookingWithinWindow.earliestIso).getTime() >
        new Date(oracle.bookingWithinWindow.latestIso).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bookingWithinWindow.earliestIso must not be after latestIso",
      });
    }
    if (oracle.depositAfterBooking === true && forbidden.includes("deposit-link")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "depositAfterBooking is true but `deposit-link` is listed in forbiddenTools",
      });
    }
  });

export type ConversationOracle = z.infer<typeof ConversationOracleSchema>;

export interface OracleViolation {
  /** Stable machine code, e.g. `missing-expected-tool:calendar-book`. */
  code: string;
  /** Human-readable detail. */
  detail: string;
}

export interface OracleResult {
  /** True iff no oracle violations. */
  pass: boolean;
  violations: OracleViolation[];
}

/**
 * Deposit-only-after-a-booking: walk the calls in order. A `deposit-link.deposit.issue`
 * that appears before any `calendar-book.booking.create` (or with none at all) is a
 * `deposit-before-booking` violation. The "confirmed" half is enforced separately by
 * forbidding `deposit-link` on a pending-booking fixture (see the `depositAfterBooking`
 * field doc). Extracted from `evaluateOracle` to keep that function's branch count down.
 */
function evaluateDepositOrdering(
  toolCalls: ReadonlyArray<{ toolId: string; operation?: string }>,
): OracleViolation[] {
  const violations: OracleViolation[] = [];
  let sawBooking = false;
  for (const call of toolCalls) {
    if (call.toolId === "calendar-book" && call.operation === "booking.create") {
      sawBooking = true;
    } else if (
      call.toolId === "deposit-link" &&
      call.operation === "deposit.issue" &&
      !sawBooking
    ) {
      violations.push({
        code: "deposit-before-booking",
        detail:
          "deposit-link.deposit.issue was called before any calendar-book.booking.create (deposit only after a confirmed booking)",
      });
    }
  }
  return violations;
}

/**
 * Evaluate a well-formed oracle against the conversation's recorded tool calls.
 *
 * Pure and total: an empty oracle (no constraints) returns `{pass:true}`. Tool
 * presence is set-membership (multiple calls of the same id count once). Inputs
 * are assumed schema-valid; malformed oracles are rejected at parse time, never
 * here.
 */
export function evaluateOracle(
  toolCalls: ReadonlyArray<{ toolId: string; operation?: string; params?: unknown }>,
  oracle: ConversationOracle,
): OracleResult {
  const called = new Set(toolCalls.map((c) => c.toolId));
  const violations: OracleViolation[] = [];

  for (const tool of oracle.expectedTools ?? []) {
    if (!called.has(tool)) {
      violations.push({
        code: `missing-expected-tool:${tool}`,
        detail: `Expected tool "${tool}" was never called`,
      });
    }
  }
  for (const tool of oracle.forbiddenTools ?? []) {
    if (called.has(tool)) {
      violations.push({
        code: `forbidden-tool-called:${tool}`,
        detail: `Forbidden tool "${tool}" was called`,
      });
    }
  }

  const escalated = called.has("escalate" satisfies AllowedToolId);
  if (oracle.expectsEscalation === true && !escalated) {
    violations.push({
      code: "expected-escalation-missing",
      detail: "Expected an escalation (escalate tool) but it was never called",
    });
  }
  if (oracle.expectsEscalation === false && escalated) {
    violations.push({
      code: "unexpected-escalation",
      detail: "Did not expect an escalation but the escalate tool was called",
    });
  }

  const booked = called.has("calendar-book" satisfies AllowedToolId);
  if (oracle.expectsBooking === true && !booked) {
    violations.push({
      code: "expected-booking-missing",
      detail: "Expected a booking (calendar-book tool) but it was never called",
    });
  }
  if (oracle.expectsBooking === false && booked) {
    violations.push({
      code: "unexpected-booking",
      detail: "Did not expect a booking but the calendar-book tool was called",
    });
  }

  // Slot-vs-window: every booking.create must land inside the lead's stated window.
  // Guards the after-hours mode where Alex books a slot the lead never offered.
  if (oracle.bookingWithinWindow) {
    const { earliestIso, latestIso } = oracle.bookingWithinWindow;
    const earliest = new Date(earliestIso).getTime();
    const latest = new Date(latestIso).getTime();
    for (const call of toolCalls) {
      if (call.toolId !== "calendar-book" || call.operation !== "booking.create") continue;
      const slotStart = (call.params as { slotStart?: unknown } | undefined)?.slotStart;
      const t = typeof slotStart === "string" ? new Date(slotStart).getTime() : NaN;
      if (!Number.isFinite(t)) {
        violations.push({
          code: "booking-window-unverifiable",
          detail: "booking.create has no parseable slotStart to verify against the window",
        });
      } else if (t < earliest || t > latest) {
        violations.push({
          code: "booking-outside-window",
          detail: `Booked slotStart ${String(slotStart)} is outside [${earliestIso}, ${latestIso}]`,
        });
      }
    }
  }

  // Deposit-only-after-a-booking (extracted helper keeps this function's branches low).
  if (oracle.depositAfterBooking) {
    violations.push(...evaluateDepositOrdering(toolCalls));
  }

  return { pass: violations.length === 0, violations };
}
