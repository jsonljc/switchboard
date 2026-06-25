import { describe, it, expect } from "vitest";
import { createMockTools } from "../mock-tools.js";
import { ALEX_ALLOWED_TOOL_IDS } from "../grade.js";

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
      contactId: "c",
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
      contactId: "c",
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
      contactId: "c",
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
