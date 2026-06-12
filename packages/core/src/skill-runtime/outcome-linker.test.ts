import { describe, it, expect, vi } from "vitest";
import { OutcomeLinker, deriveLinkedOutcome } from "./outcome-linker.js";
import type { ToolCallRecord } from "./types.js";
import { ok } from "./tool-result.js";

function makeStore() {
  return { linkOutcome: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolId: "crm-query",
    operation: "contact.get",
    params: {},
    result: ok(),
    durationMs: 10,
    governanceDecision: "auto-approved",
    ...overrides,
  };
}

describe("OutcomeLinker", () => {
  it("links stage update to opportunity", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: ok(
          { id: "opp-1", stage: "qualified" },
          { entityState: { opportunityId: "opp-1", stage: "qualified" } },
        ),
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
      id: "opp-1",
      type: "opportunity",
      result: "stage_qualified",
    });
  });

  it("links opt-out activity log as outcome", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "activity.log",
        params: { eventType: "opt-out" },
        result: ok(undefined, { entityState: { eventType: "opt-out" } }),
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
      id: "trace-1",
      type: "task",
      result: "opt_out",
    });
  });

  it("links only the first matching outcome (stage update wins over opt-out)", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: ok(
          { id: "opp-1", stage: "quoted" },
          { entityState: { opportunityId: "opp-1", stage: "quoted" } },
        ),
      }),
      makeToolCall({
        toolId: "crm-write",
        operation: "activity.log",
        params: { eventType: "opt-out" },
        result: ok(undefined, { entityState: { eventType: "opt-out" } }),
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledTimes(1);
    expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
      id: "opp-1",
      type: "opportunity",
      result: "stage_quoted",
    });
  });

  it("does nothing when no business outcome detected", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({ toolId: "crm-query", operation: "contact.get" }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("does nothing for empty tool calls", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", []);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("skips stage update without opportunityId", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: {},
        result: ok({ stage: "qualified" }, { entityState: { stage: "qualified" } }),
      }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("links a successful booking as a typed booked outcome", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "calendar-book",
        operation: "booking.create",
        params: { service: "botox", slotStart: "2026-06-12T03:00:00Z" },
        result: ok(
          { bookingId: "bk_1", status: "confirmed" },
          { entityState: { bookingId: "bk_1", status: "confirmed" } },
        ),
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
      id: "bk_1",
      type: "booking",
      result: "booked",
    });
  });

  it("prefers the booking outcome over a stage update in the same turn", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: ok(
          { stage: "booked" },
          { entityState: { opportunityId: "opp-1", stage: "booked" } },
        ),
      }),
      makeToolCall({
        toolId: "calendar-book",
        operation: "booking.create",
        params: { service: "botox" },
        result: ok(
          { bookingId: "bk_9" },
          { entityState: { bookingId: "bk_9", status: "confirmed" } },
        ),
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledTimes(1);
    expect(store.linkOutcome).toHaveBeenCalledWith("org_1", "trace-1", {
      id: "bk_9",
      type: "booking",
      result: "booked",
    });
  });

  it("does not link a failed booking", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("org_1", "trace-1", [
      makeToolCall({
        toolId: "calendar-book",
        operation: "booking.create",
        params: { service: "botox" },
        result: {
          status: "error",
          error: { code: "SLOT_TAKEN", message: "taken", retryable: true },
        },
      }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("exposes deriveLinkedOutcome as a pure function", () => {
    expect(
      deriveLinkedOutcome(
        [
          makeToolCall({
            toolId: "calendar-book",
            operation: "booking.create",
            params: {},
            result: ok({ bookingId: "bk_2" }, { entityState: { bookingId: "bk_2" } }),
          }),
        ],
        "trace-x",
      ),
    ).toEqual({ id: "bk_2", type: "booking", result: "booked" });
    expect(deriveLinkedOutcome([], "trace-x")).toBeNull();
  });
});
