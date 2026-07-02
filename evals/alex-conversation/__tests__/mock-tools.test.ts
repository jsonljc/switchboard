import { describe, it, expect } from "vitest";
import { createMockTools } from "../mock-tools.js";
import { ALEX_ALLOWED_TOOL_IDS } from "../grade.js";
import {
  CRM_QUERY_CONTACT_GET_INPUT_SCHEMA,
  CRM_QUERY_ACTIVITY_LIST_INPUT_SCHEMA,
  CALENDAR_BOOK_BOOKING_CREATE_INPUT_SCHEMA,
  createCrmQueryToolFactory,
  createCrmWriteToolFactory,
  createCalendarBookToolFactory,
  createEscalateToolFactory,
  createScheduleFollowUpToolFactory,
  createDelegateToolFactory,
  createDepositLinkToolFactory,
  type SkillTool,
  type DelegateToolDeps,
} from "@switchboard/core/skill-runtime";
// Still needed (not dropped): createDelegateToolFactory's op schema is INJECTED via
// deps.targets (apps/api/src/bootstrap/delegation-targets.ts), not baked into the
// factory like every other tool's schema constants are, so buildRealAlexTools()
// below must supply the SAME constant itself to construct the real creative_concept
// operation. See delegateDeps for why.
import { CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA } from "@switchboard/schemas";

/**
 * EV-5 / AGENT-5: tool-contract parity with production, pinned to the REAL Alex
 * tools BY CONSTRUCTION (not a hand-maintained table). The alex-conversation eval
 * is the highest-coverage agent eval; it must present Alex the EXACT tool contracts
 * production registers, or it silently tests a fictional surface (the
 * "mock-tool-blind" gap). We construct each real Alex tool factory (stub deps: the
 * assertions read ONLY static operation metadata (effectCategory / idempotent /
 * inputSchema / op keys), so `execute` is never called and the stub deps are never
 * touched) and assert the mock is identical to it. This pins op-set, effect,
 * idempotent, AND input schema to the real tools by identity: a real-tool contract
 * change (an effectCategory flip, a renamed op, a re-inlined schema) reds this test,
 * which the old hand-typed literal table could not catch.
 */
function buildRealAlexTools(): Map<string, SkillTool> {
  // The real factories set operation metadata statically and touch deps/ctx only
  // inside `execute`; these parity assertions never execute, so empty stubs suffice
  // for every factory EXCEPT delegate (see delegateDeps below).
  const noDeps = {} as never;
  const noCtx = {} as never;
  // createDelegateToolFactory eagerly iterates `deps.targets` WHILE BUILDING the
  // tool (packages/core/src/skill-runtime/tools/delegate.ts: `for (const target of
  // deps.targets)`), not inside `execute`, so `{} as never` throws "deps.targets is
  // not iterable" at construction. Alex's real (and only) wired target is the
  // `creative_concept` handoff to Mira (apps/api/src/bootstrap/delegation-targets.ts
  // CREATIVE_CONCEPT_TARGET), reproduced here as the minimal stub that avoids the
  // throw and reflects the real op-set. Fidelity boundary: `effectCategory` and
  // `idempotent` come from the REAL core factory (delegate.ts) so they are
  // production-pinned; the op-name and inputSchema are supplied by this stub because
  // the eval harness deliberately never imports from apps/*, so renaming
  // CREATIVE_CONCEPT_TARGET.operation or swapping its inputSchema in apps/api would
  // NOT red this test. inputSchema still references the shared
  // CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA constant the mock uses, so the `toBe` holds.
  // `submitter` and `mapInput` satisfy the required types but are only read inside
  // `execute`, which these assertions never call.
  const delegateDeps: DelegateToolDeps = {
    submitter: {
      submitChildWork: () => {
        throw new Error("stub submitter: construction-only, execute is never called here");
      },
    },
    targets: [
      {
        operation: "creative_concept",
        intent: "creative.concept.draft",
        description: "stub target for construction-only tool-metadata assertions",
        inputSchema: CREATIVE_CONCEPT_TOOL_INPUT_SCHEMA,
        mapInput: (input: unknown) => input as Record<string, unknown>,
      },
    ],
  };
  const constructed: SkillTool[] = [
    // crm-query/crm-write take two positional store deps (not one deps object);
    // `noDeps` satisfies both positions since neither is dereferenced outside
    // `execute`.
    createCrmQueryToolFactory(noDeps, noDeps)(noCtx),
    createCrmWriteToolFactory(noDeps, noDeps)(noCtx),
    // calendar-book includes booking.reschedule/cancel (spread inside the factory).
    createCalendarBookToolFactory(noDeps)(noCtx),
    createEscalateToolFactory(noDeps)(noCtx),
    createScheduleFollowUpToolFactory(noDeps)(noCtx),
    createDelegateToolFactory(delegateDeps)(noCtx),
    createDepositLinkToolFactory(noDeps)(noCtx),
  ];
  return new Map(constructed.map((t) => [t.id, t]));
}

describe("mock-tools - tool-contract parity with the REAL Alex tools (by construction)", () => {
  const { tools: mock } = createMockTools();
  const real = buildRealAlexTools();

  it("mock tool-id set === real constructed tool-id set === ALEX_ALLOWED_TOOL_IDS", () => {
    const realIds = [...real.keys()].sort();
    expect([...mock.keys()].sort(), "mock toolset drifted from the real Alex tools").toEqual(
      realIds,
    );
    expect([...ALEX_ALLOWED_TOOL_IDS].sort(), "ALEX_ALLOWED_TOOL_IDS drifted from real").toEqual(
      realIds,
    );
  });

  const opPairs = [...real].flatMap(([toolId, tool]) =>
    Object.keys(tool.operations).map((operation) => ({
      toolId,
      operation,
      // Precomputed so the vitest reporter renders "crm-query.contact.get"; a
      // "$toolId.$operation" title interpolates as "undefined" (vitest treats the
      // dot as a property path on toolId).
      name: `${toolId}.${operation}`,
    })),
  );

  it.each(opPairs)(
    "$name: mock effectCategory / idempotent / inputSchema are IDENTICAL to the real tool",
    ({ toolId, operation }) => {
      const realOp = real.get(toolId)!.operations[operation]!;
      const mockTool = mock.get(toolId);
      expect(mockTool, `mock is missing tool ${toolId}`).toBeDefined();
      const mockOp = mockTool!.operations[operation];
      expect(mockOp, `mock ${toolId} is missing operation ${operation}`).toBeDefined();
      // Non-vacuous guard: the real op is a genuine schema-bearing operation, so the
      // identity assertions below cannot pass vacuously.
      expect(realOp.inputSchema, `real ${toolId}.${operation} has no inputSchema`).toMatchObject({
        type: "object",
      });
      // Identity (toBe), NOT deepEqual: the mock must present the SAME frozen schema
      // constant the real tool references, and the SAME effect/idempotent, so the eval
      // can never silently drift from the production tool contract.
      expect(mockOp!.inputSchema).toBe(realOp.inputSchema);
      expect(mockOp!.effectCategory).toBe(realOp.effectCategory);
      expect(mockOp!.idempotent ?? false).toBe(realOp.idempotent ?? false);
    },
  );

  it("mock exposes exactly the real op-set per tool (no invented / missing ops)", () => {
    for (const [toolId, tool] of real) {
      expect(
        Object.keys(mock.get(toolId)!.operations).sort(),
        `mock ${toolId} op-set drifted from real`,
      ).toEqual(Object.keys(tool.operations).sort());
    }
  });

  // Targeted contract-shape drift pins on the exported schema constants (source of
  // truth). These pin the SHAPE of the highest-risk contracts, complementing the
  // by-construction identity checks above.
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
    const delegate = mock.get("delegate")!;
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
