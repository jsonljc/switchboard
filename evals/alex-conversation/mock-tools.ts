import { ok, fail, pendingApproval } from "@switchboard/core/skill-runtime";
import type { SkillTool, ToolResult } from "@switchboard/core/skill-runtime";
import {
  CRM_QUERY_CONTACT_GET_INPUT_SCHEMA,
  CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA,
  CRM_WRITE_STAGE_UPDATE_INPUT_SCHEMA,
  CRM_WRITE_ACTIVITY_LOG_INPUT_SCHEMA,
  CALENDAR_BOOK_SLOTS_QUERY_INPUT_SCHEMA,
  CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA,
  CALENDAR_BOOK_BOOKING_RESCHEDULE_INPUT_SCHEMA,
  CALENDAR_BOOK_BOOKING_CANCEL_INPUT_SCHEMA,
  ESCALATE_HANDOFF_CREATE_INPUT_SCHEMA,
  FOLLOW_UP_SCHEDULE_INPUT_SCHEMA,
  DEPOSIT_LINK_ISSUE_INPUT_SCHEMA,
} from "@switchboard/core/skill-runtime";
import { CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA } from "@switchboard/schemas";

/**
 * Per-fixture booking behavior for the `calendar-book.booking.create` mock.
 * "success" (default) books; "pending" parks for human approval; "slot_taken"
 * returns a retryable SLOT_TAKEN failure (overlap). Mirrors the real tool's
 * booked / pending_approval / SLOT_TAKEN outcomes so reschedule/cancel/slot-taken
 * + governed-close fixtures can be driven deterministically.
 */
export type MockBookingBehavior = "success" | "pending" | "slot_taken";

/**
 * One recorded tool invocation. The grader uses these to assert tool usage and
 * ordering (e.g. "qualify before booking" — `crm-write.stage.update` /
 * `crm-query.contact.get` must appear before `calendar-book.booking.create`).
 */
export interface RecordedToolCall {
  /** Tool id, e.g. "calendar-book". */
  toolId: string;
  /** Operation name, e.g. "booking.create". */
  operation: string;
  /** Fully-qualified name as the model issued it, e.g. "calendar-book.booking.create". */
  name: string;
  /** Raw params the model supplied. */
  params: unknown;
  /** Monotonic call index across ALL tools in this conversation (0-based). */
  order: number;
}

/**
 * A `Map<string, SkillTool>` of benign, deterministic mock tools plus a `calls`
 * array that records every operation invocation in order.
 *
 * The tool ids, operation names, effect categories, and input schemas mirror the
 * real Alex tools (crm-query / crm-write / calendar-book / escalate / follow-up /
 * delegate / deposit-link) so the LLM sees the same tool definitions production
 * registers — but every `execute` returns a benign `ok(...)` and performs no side
 * effects. Because the eval executor runs with NO governance hooks,
 * write/external_mutation operations are NOT gated here; the mocks simply succeed
 * and record the call.
 *
 * EV-5 / AGENT-5: each operation's `inputSchema` is the SAME exported constant the
 * real tool uses (imported above), NOT a hand-copied literal. This makes the eval
 * present the EXACT production input contract and makes drift impossible — pinned
 * by the parity assertions in `__tests__/mock-tools.test.ts`. Operation-level
 * `description` strings remain the mock's own (documentation, not the contract).
 */
export interface MockTools {
  tools: Map<string, SkillTool>;
  calls: RecordedToolCall[];
}

export function createMockTools(
  opts: {
    bookingBehavior?: MockBookingBehavior;
    /**
     * Per-fixture slots.query behavior. "available" (default) returns two open
     * slots; "empty" returns no slots so the after-hours path is exercised — the
     * agent must offer a wider window, not claim the system is broken or escalate.
     */
    slotsBehavior?: "available" | "empty";
  } = {},
): MockTools {
  const calls: RecordedToolCall[] = [];

  const record = (toolId: string, operation: string, params: unknown): void => {
    calls.push({
      toolId,
      operation,
      name: `${toolId}.${operation}`,
      params,
      order: calls.length,
    });
  };

  const recordingOp = (
    toolId: string,
    operation: string,
    description: string,
    effectCategory: SkillTool["operations"][string]["effectCategory"],
    inputSchema: Record<string, unknown>,
    data: () => Record<string, unknown> | undefined,
    idempotent = true,
  ): SkillTool["operations"][string] => ({
    description,
    effectCategory,
    idempotent,
    inputSchema,
    execute: async (params: unknown): Promise<ToolResult> => {
      record(toolId, operation, params);
      return ok(data());
    },
  });

  const crmQuery: SkillTool = {
    id: "crm-query",
    operations: {
      "contact.get": recordingOp(
        "crm-query",
        "contact.get",
        "Get the current contact. Returns name, stage, source.",
        "read",
        CRM_QUERY_CONTACT_GET_INPUT_SCHEMA,
        () => ({
          id: "mock-contact",
          name: null,
          phone: null,
          email: null,
          stage: "interested",
          source: "whatsapp",
        }),
      ),
      "activity.list": recordingOp(
        "crm-query",
        "activity.list",
        "List recent activity for this deployment.",
        "read",
        CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA,
        () => ({ activities: [] }),
      ),
    },
  };

  const crmWrite: SkillTool = {
    id: "crm-write",
    operations: {
      "stage.update": recordingOp(
        "crm-write",
        "stage.update",
        "Update an opportunity's pipeline stage.",
        "write",
        CRM_WRITE_STAGE_UPDATE_INPUT_SCHEMA,
        () => ({ ok: true }),
      ),
      "activity.log": recordingOp(
        "crm-write",
        "activity.log",
        "Log an activity event.",
        "write",
        CRM_WRITE_ACTIVITY_LOG_INPUT_SCHEMA,
        () => undefined,
        false,
      ),
    },
  };

  const calendarBook: SkillTool = {
    id: "calendar-book",
    operations: {
      "slots.query": recordingOp(
        "calendar-book",
        "slots.query",
        "Query available calendar slots for a date range.",
        "read",
        CALENDAR_BOOK_SLOTS_QUERY_INPUT_SCHEMA,
        () => ({
          slots:
            opts.slotsBehavior === "empty"
              ? []
              : [
                  { start: "2026-06-01T02:00:00.000Z", end: "2026-06-01T03:00:00.000Z" },
                  { start: "2026-06-01T06:00:00.000Z", end: "2026-06-01T07:00:00.000Z" },
                ],
        }),
      ),
      "booking.create": {
        description:
          "Book a calendar slot for a contact. Persists booking, creates calendar event, emits booked event via outbox.",
        effectCategory: "external_mutation",
        idempotent: true,
        inputSchema: CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA,
        execute: async (params: unknown): Promise<ToolResult> => {
          // Record the call FIRST so the oracle still sees a calendar-book call
          // even when the booking parks for approval or the slot was taken.
          record("calendar-book", "booking.create", params);
          if (opts.bookingBehavior === "pending") {
            return pendingApproval("APPROVAL_REQUIRED");
          }
          if (opts.bookingBehavior === "slot_taken") {
            return fail("SLOT_TAKEN", "That time was just taken.", {
              retryable: true,
              data: { failureType: "slot_conflict" },
              modelRemediation:
                "Re-run calendar-book.slots.query and offer the next available times.",
            });
          }
          return ok({ bookingId: "mock-booking", status: "confirmed" });
        },
      },
      "booking.reschedule": recordingOp(
        "calendar-book",
        "booking.reschedule",
        "Reschedule the contact's upcoming appointment to a new slot.",
        "external_mutation",
        CALENDAR_BOOK_BOOKING_RESCHEDULE_INPUT_SCHEMA,
        () => ({ bookingId: "mock-booking", status: "rescheduled" }),
        false,
      ),
      "booking.cancel": recordingOp(
        "calendar-book",
        "booking.cancel",
        "Cancel the contact's upcoming appointment.",
        "external_mutation",
        CALENDAR_BOOK_BOOKING_CANCEL_INPUT_SCHEMA,
        () => ({ bookingId: "mock-booking", status: "cancelled" }),
        false,
      ),
    },
  };

  const escalate: SkillTool = {
    id: "escalate",
    operations: {
      "handoff.create": recordingOp(
        "escalate",
        "handoff.create",
        "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, or when the customer is frustrated.",
        "write",
        ESCALATE_HANDOFF_CREATE_INPUT_SCHEMA,
        () => ({ handoffId: "mock-handoff", status: "pending" }),
        false,
      ),
    },
  };

  // Mirrors the real `follow-up` tool (skills/alex/SKILL.md + core
  // skill-runtime/tools/schedule-follow-up.ts): id, operation name, effect
  // category, and input schema match so the executor offers the same definition
  // production registers. The mock only records the call (no scheduling).
  const followUp: SkillTool = {
    id: "follow-up",
    operations: {
      "followup.schedule": recordingOp(
        "follow-up",
        "followup.schedule",
        "Schedule a single WhatsApp re-engagement follow-up for this lead, to be sent automatically later (only if consent, the messaging window, and an approved template all allow). Use when a qualified lead has gone quiet or hesitant. Do not schedule more than one follow-up per conversation.",
        "write",
        FOLLOW_UP_SCHEDULE_INPUT_SCHEMA,
        () => ({
          followUpId: "mock-followup",
          scheduledFor: "2026-06-04T00:00:00.000Z",
          status: "scheduled",
        }),
      ),
    },
  };

  // Mirrors the real `delegate` tool (core skill-runtime/tools/delegate.ts) as
  // wired for Alex (apps/api bootstrap/delegation-targets.ts CREATIVE_CONCEPT_TARGET):
  // the single allowlisted target is the Alex -> Mira `creative_concept` handoff,
  // effectCategory "propose" (the child carries the real governance weight at
  // PlatformIngress). The input schema is the shared CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA
  // constant the live target also uses. The description mirrors the live target's
  // (it is documentation, not the asserted contract). The mock only records the call.
  const delegate: SkillTool = {
    id: "delegate",
    operations: {
      creative_concept: recordingOp(
        "delegate",
        "creative_concept",
        "Hand a creative concept to Mira (the creative agent) as a DRAFT for the team to review. " +
          "Use ONLY for a clearly interested, qualified lead who would benefit from a tailored offer/creative. " +
          "This creates an internal draft on the team's board - it does NOT send anything to the customer and " +
          "does NOT replace escalate. Provide the treatment/offer the lead wants and who it targets.",
        "propose",
        CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA,
        () => ({ childWorkUnitId: "cwu_mock", outcome: "queued" }),
      ),
    },
  };

  // Mirrors the real `deposit-link` tool (core skill-runtime/tools/deposit-link.ts):
  // id, operation name ("deposit.issue"), effect category ("read", idempotent), and
  // input schema match so the executor offers the same definition production registers.
  // The mock returns a benign deterministic link and records the call, so the
  // book->pay leg is exercised and a correct deposit call is NOT graded unexpected.
  const depositLink: SkillTool = {
    id: "deposit-link",
    operations: {
      "deposit.issue": recordingOp(
        "deposit-link",
        "deposit.issue",
        "Issue a deposit payment link for a confirmed booking. Idempotent; returns the same link on replay.",
        "read",
        DEPOSIT_LINK_ISSUE_INPUT_SCHEMA,
        () => ({
          url: "https://pay.mock/deposit/mock-booking",
          externalReference: "mock-deposit-ref",
          amountCents: 5000,
        }),
      ),
    },
  };

  const tools = new Map<string, SkillTool>([
    ["crm-query", crmQuery],
    ["crm-write", crmWrite],
    ["calendar-book", calendarBook],
    ["escalate", escalate],
    ["follow-up", followUp],
    ["delegate", delegate],
    ["deposit-link", depositLink],
  ]);

  return { tools, calls };
}
