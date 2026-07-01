import { describe, it, expect } from "vitest";
import { createMockTools } from "../mock-tools.js";
import { ALEX_ALLOWED_TOOL_IDS } from "../grade.js";
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
 * EV-5 / AGENT-5 — tool input-schema parity. The alex-conversation eval is the
 * highest-coverage agent eval; it must present Alex the EXACT tool input
 * contracts production registers, or it silently tests against a fictional
 * contract (the "mock-tool-blind" gap). Each real tool exports its operation
 * input schema as a constant (the live tool references it), and the mock below
 * imports + reuses those SAME constants — so this table asserts identity (`toBe`),
 * which can never pass against a drifted literal. The table is the canonical
 * Alex tool surface: { toolId, operation } -> { real schema const, effect, idempotent }.
 */
const PRODUCTION_TOOL_PARITY: ReadonlyArray<{
  toolId: string;
  operation: string;
  schema: Record<string, unknown>;
  effectCategory: string;
  idempotent: boolean;
}> = [
  {
    toolId: "crm-query",
    operation: "contact.get",
    schema: CRM_QUERY_CONTACT_GET_INPUT_SCHEMA,
    effectCategory: "read",
    idempotent: true,
  },
  {
    toolId: "crm-query",
    operation: "activity.list",
    schema: CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA,
    effectCategory: "read",
    idempotent: true,
  },
  {
    toolId: "crm-write",
    operation: "stage.update",
    schema: CRM_WRITE_STAGE_UPDATE_INPUT_SCHEMA,
    effectCategory: "write",
    idempotent: true,
  },
  {
    toolId: "crm-write",
    operation: "activity.log",
    schema: CRM_WRITE_ACTIVITY_LOG_INPUT_SCHEMA,
    effectCategory: "write",
    idempotent: false,
  },
  {
    toolId: "calendar-book",
    operation: "slots.query",
    schema: CALENDAR_BOOK_SLOTS_QUERY_INPUT_SCHEMA,
    effectCategory: "read",
    idempotent: true,
  },
  {
    toolId: "calendar-book",
    operation: "booking.create",
    schema: CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA,
    effectCategory: "external_mutation",
    idempotent: true,
  },
  {
    toolId: "calendar-book",
    operation: "booking.reschedule",
    schema: CALENDAR_BOOK_BOOKING_RESCHEDULE_INPUT_SCHEMA,
    effectCategory: "external_mutation",
    idempotent: false,
  },
  {
    toolId: "calendar-book",
    operation: "booking.cancel",
    schema: CALENDAR_BOOK_BOOKING_CANCEL_INPUT_SCHEMA,
    effectCategory: "external_mutation",
    idempotent: false,
  },
  {
    toolId: "escalate",
    operation: "handoff.create",
    schema: ESCALATE_HANDOFF_CREATE_INPUT_SCHEMA,
    effectCategory: "write",
    idempotent: false,
  },
  {
    toolId: "follow-up",
    operation: "followup.schedule",
    schema: FOLLOW_UP_SCHEDULE_INPUT_SCHEMA,
    effectCategory: "write",
    idempotent: true,
  },
  {
    toolId: "delegate",
    operation: "creative_concept",
    schema: CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA,
    effectCategory: "propose",
    idempotent: true,
  },
  {
    toolId: "deposit-link",
    operation: "deposit.issue",
    schema: DEPOSIT_LINK_ISSUE_INPUT_SCHEMA,
    effectCategory: "read",
    idempotent: true,
  },
];

describe("mock-tools — tool input-schema parity with production (mock-tool-blind gap, EV-5/AGENT-5)", () => {
  const { tools } = createMockTools();

  it.each(PRODUCTION_TOOL_PARITY)(
    "$toolId.$operation presents the EXACT production input schema (by import) + effect/idempotent",
    ({ toolId, operation, schema, effectCategory, idempotent }) => {
      // Non-vacuous guard: the imported production constant must be a real schema
      // object, so `toBe(schema)` below can never pass vacuously (e.g. were the
      // export ever undefined at runtime, undefined === undefined would slip by).
      expect(schema, `imported schema for ${toolId}.${operation} is not an object`).toMatchObject({
        type: "object",
      });
      const tool = tools.get(toolId);
      expect(tool, `mock is missing tool ${toolId}`).toBeDefined();
      const op = tool!.operations[operation];
      expect(op, `mock ${toolId} is missing operation ${operation}`).toBeDefined();
      // Identity (toBe), NOT deepEqual: the mock must REFERENCE the same exported
      // schema constant the real tool uses, so the eval can never silently drift
      // from the production tool contract. A re-inlined literal fails this.
      expect(op!.inputSchema).toBe(schema);
      expect(op!.effectCategory).toBe(effectCategory);
      expect(op!.idempotent ?? false).toBe(idempotent);
    },
  );

  it("the mock tool-id set equals Alex's real registered toolset (ALEX_ALLOWED_TOOL_IDS)", () => {
    expect([...tools.keys()].sort()).toEqual([...ALEX_ALLOWED_TOOL_IDS].sort());
  });

  it("the mock exposes exactly the production operations per tool (no invented/missing ops)", () => {
    const opsByTool = new Map<string, string[]>();
    for (const { toolId, operation } of PRODUCTION_TOOL_PARITY) {
      opsByTool.set(toolId, [...(opsByTool.get(toolId) ?? []), operation]);
    }
    for (const [toolId, ops] of opsByTool) {
      expect(Object.keys(tools.get(toolId)!.operations).sort()).toEqual([...ops].sort());
    }
  });

  // Targeted drift pins — the specific contract regressions this slice closes.
  // These assert on the EXPORTED production constants (the source of truth), so
  // they pin the real tool contract, not just the mock.
  it("booking.create accepts NO contactId / attendee fields (contactId is ctx-injected, AI-1)", () => {
    const props = CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA["properties"] as Record<
      string,
      unknown
    >;
    const required = CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA["required"] as string[];
    expect(Object.keys(props).sort()).toEqual(["calendarId", "service", "slotEnd", "slotStart"]);
    expect(required).not.toContain("contactId");
    for (const banned of ["contactId", "attendeeName", "attendeeEmail"]) {
      expect(props).not.toHaveProperty(banned);
    }
  });

  it("crm-query operations accept NO trust-bound ids (orgId/contactId/deploymentId are ctx-injected)", () => {
    expect(CRM_QUERY_CONTACT_GET_INPUT_SCHEMA["properties"]).toEqual({});
    expect(CRM_QUERY_CONTACT_GET_INPUT_SCHEMA["required"]).toEqual([]);
    expect(Object.keys(CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA["properties"] as object)).toEqual([
      "limit",
    ]);
    expect(CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA["required"]).toEqual([]);
  });

  it("delegate exposes the real creative_concept operation, not a fictional task.delegate", () => {
    const delegate = tools.get("delegate")!;
    expect(Object.keys(delegate.operations)).toEqual(["creative_concept"]);
    expect(delegate.operations["creative_concept"]!.effectCategory).toBe("propose");
    expect(delegate.operations["task.delegate"]).toBeUndefined();
  });
});

// A3 (#785/#786) added a `follow-up` tool to Alex's SKILL.md (frontmatter
// `tools:` + a "Scheduling a follow-up" section). The eval harness must mirror
// it so the executor OFFERS it (buildToolDefinitions reads the injected tool
// map) and the grader treats a follow-up call as an allowed tool — otherwise the
// new capability is untested and a follow-up call would grade as unexpected.
describe("mock-tools — follow-up tool parity with the real Alex skill", () => {
  it("registers a follow-up tool whose followup.schedule operation matches the real schema", () => {
    const { tools } = createMockTools();
    const followUp = tools.get("follow-up");
    expect(followUp).toBeDefined();

    const op = followUp!.operations["followup.schedule"];
    expect(op).toBeDefined();
    expect(op!.effectCategory).toBe("write");

    const schema = op!.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    expect(schema.required).toEqual(["reason", "delay"]);
    expect(schema.properties["reason"]!.enum).toEqual([
      "hesitation",
      "price_concern",
      "timing_not_now",
      "awaiting_info",
      "went_quiet",
    ]);
    expect(schema.properties["delay"]!.enum).toEqual(["in_1_day", "in_3_days", "in_1_week"]);
  });

  it("records a follow-up.followup.schedule invocation in calls[]", async () => {
    const { tools, calls } = createMockTools();
    const op = tools.get("follow-up")!.operations["followup.schedule"]!;

    await op.execute({ reason: "went_quiet", delay: "in_3_days" });

    expect(calls.at(-1)).toMatchObject({
      toolId: "follow-up",
      operation: "followup.schedule",
      name: "follow-up.followup.schedule",
      params: { reason: "went_quiet", delay: "in_3_days" },
    });
  });

  it("includes follow-up in ALEX_ALLOWED_TOOL_IDS (so a follow-up call is not graded as unexpected)", () => {
    expect(ALEX_ALLOWED_TOOL_IDS).toContain("follow-up");
  });
});

// PR-B "Booking Lifecycle Integrity": Alex's calendar-book tool gained
// reschedule + cancel operations and a SLOT_TAKEN / pending_approval outcome on
// booking.create. The mock must mirror those so the offline harness exercises
// reschedule/cancel/slot-taken + governed-close fixtures deterministically.
describe("mock-tools — booking lifecycle (reschedule / cancel / pending / slot-taken)", () => {
  it("exposes booking.reschedule and booking.cancel external_mutation ops on calendar-book", () => {
    const calendarBook = createMockTools().tools.get("calendar-book");
    expect(calendarBook).toBeDefined();

    const reschedule = calendarBook!.operations["booking.reschedule"];
    expect(reschedule).toBeDefined();
    expect(reschedule!.effectCategory).toBe("external_mutation");

    const cancel = calendarBook!.operations["booking.cancel"];
    expect(cancel).toBeDefined();
    expect(cancel!.effectCategory).toBe("external_mutation");
  });

  it("records booking.reschedule and booking.cancel invocations in calls[]", async () => {
    const { tools, calls } = createMockTools();
    const ops = tools.get("calendar-book")!.operations;

    const rescheduled = await ops["booking.reschedule"]!.execute({
      slotStart: "2026-06-10T02:00:00.000Z",
      slotEnd: "2026-06-10T03:00:00.000Z",
      calendarId: "cal-1",
    });
    expect(rescheduled.status).toBe("success");
    expect(rescheduled.data).toMatchObject({ status: "rescheduled" });

    const cancelled = await ops["booking.cancel"]!.execute({ reason: "lead requested" });
    expect(cancelled.status).toBe("success");
    expect(cancelled.data).toMatchObject({ status: "cancelled" });

    expect(calls.map((c) => c.name)).toEqual([
      "calendar-book.booking.reschedule",
      "calendar-book.booking.cancel",
    ]);
  });

  it("default booking.create books successfully (status:success, confirmed)", async () => {
    const { tools, calls } = createMockTools();
    const result = await tools.get("calendar-book")!.operations["booking.create"]!.execute({
      service: "filler",
      slotStart: "x",
      slotEnd: "y",
      calendarId: "cal",
    });
    expect(result.status).toBe("success");
    expect(result.data).toMatchObject({ bookingId: "mock-booking", status: "confirmed" });
    // The call is still recorded (oracle sees a calendar-book call).
    expect(calls.at(-1)).toMatchObject({ name: "calendar-book.booking.create" });
  });

  it("bookingBehavior:'pending' makes booking.create park for approval (status:pending_approval)", async () => {
    const { tools, calls } = createMockTools({ bookingBehavior: "pending" });
    const result = await tools.get("calendar-book")!.operations["booking.create"]!.execute({
      service: "filler",
      slotStart: "x",
      slotEnd: "y",
      calendarId: "cal",
    });
    expect(result.status).toBe("pending_approval");
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
    // Records the call FIRST so the oracle still observes a calendar-book call.
    expect(calls.at(-1)).toMatchObject({ name: "calendar-book.booking.create" });
  });

  it("bookingBehavior:'slot_taken' makes booking.create fail with retryable SLOT_TAKEN", async () => {
    const { tools, calls } = createMockTools({ bookingBehavior: "slot_taken" });
    const result = await tools.get("calendar-book")!.operations["booking.create"]!.execute({
      service: "filler",
      slotStart: "x",
      slotEnd: "y",
      calendarId: "cal",
    });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("SLOT_TAKEN");
    expect(result.error?.retryable).toBe(true);
    expect(calls.at(-1)).toMatchObject({ name: "calendar-book.booking.create" });
  });
});

describe("mock-tools — slots.query availability + deposit-link parity", () => {
  const slotQuery = {
    dateFrom: "a",
    dateTo: "b",
    durationMinutes: 30,
    service: "filler",
    timezone: "Asia/Singapore",
  };

  it("default slots.query returns open slots", async () => {
    const { tools } = createMockTools();
    const result = await tools.get("calendar-book")!.operations["slots.query"]!.execute(slotQuery);
    expect(result.status).toBe("success");
    expect((result.data as { slots: unknown[] }).slots.length).toBeGreaterThan(0);
  });

  it("slotsBehavior:'empty' makes slots.query return no slots (drives the after-hours path)", async () => {
    const { tools } = createMockTools({ slotsBehavior: "empty" });
    const result = await tools.get("calendar-book")!.operations["slots.query"]!.execute(slotQuery);
    expect(result.status).toBe("success");
    expect(result.data).toMatchObject({ slots: [] });
  });

  it("exposes a deposit-link tool whose deposit.issue op mirrors the real tool", async () => {
    const { tools, calls } = createMockTools();
    const deposit = tools.get("deposit-link");
    expect(deposit?.operations["deposit.issue"]).toBeDefined();
    expect(deposit!.operations["deposit.issue"]!.effectCategory).toBe("read");
    const result = await deposit!.operations["deposit.issue"]!.execute({
      bookingId: "mock-booking",
    });
    expect(result.status).toBe("success");
    expect(result.data).toMatchObject({ url: expect.any(String), amountCents: expect.any(Number) });
    expect(calls.at(-1)).toMatchObject({ name: "deposit-link.deposit.issue" });
  });
});
