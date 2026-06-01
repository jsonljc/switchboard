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
 * Evaluate a well-formed oracle against the conversation's recorded tool calls.
 *
 * Pure and total: an empty oracle (no constraints) returns `{pass:true}`. Tool
 * presence is set-membership (multiple calls of the same id count once). Inputs
 * are assumed schema-valid; malformed oracles are rejected at parse time, never
 * here.
 */
export function evaluateOracle(
  toolCalls: ReadonlyArray<{ toolId: string }>,
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

  return { pass: violations.length === 0, violations };
}
