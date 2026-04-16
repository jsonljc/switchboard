import { describe, it, expect, vi } from "vitest";
import { OutcomeLinker } from "./outcome-linker.js";
import type { ToolCallRecord } from "./types.js";

function makeStore() {
  return { linkOutcome: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolId: "crm-query",
    operation: "contact.get",
    params: {},
    result: {},
    durationMs: 10,
    governanceDecision: "auto-approved",
    ...overrides,
  };
}

describe("OutcomeLinker", () => {
  it("links stage update to opportunity", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: { stage: "qualified" },
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("trace-1", {
      id: "opp-1",
      type: "opportunity",
      result: "stage_qualified",
    });
  });

  it("links opt-out activity log as outcome", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "activity.log",
        params: { eventType: "opt-out" },
        result: {},
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledWith("trace-1", {
      id: "trace-1",
      type: "task",
      result: "opt_out",
    });
  });

  it("links only the first matching outcome (stage update wins over opt-out)", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: { opportunityId: "opp-1" },
        result: { stage: "quoted" },
      }),
      makeToolCall({
        toolId: "crm-write",
        operation: "activity.log",
        params: { eventType: "opt-out" },
        result: {},
      }),
    ]);
    expect(store.linkOutcome).toHaveBeenCalledTimes(1);
    expect(store.linkOutcome).toHaveBeenCalledWith("trace-1", {
      id: "opp-1",
      type: "opportunity",
      result: "stage_quoted",
    });
  });

  it("does nothing when no business outcome detected", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({ toolId: "crm-query", operation: "contact.get" }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("does nothing for empty tool calls", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", []);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });

  it("skips stage update without opportunityId", async () => {
    const store = makeStore();
    const linker = new OutcomeLinker(store);
    await linker.linkFromToolCalls("trace-1", [
      makeToolCall({
        toolId: "crm-write",
        operation: "stage.update",
        params: {},
        result: { stage: "qualified" },
      }),
    ]);
    expect(store.linkOutcome).not.toHaveBeenCalled();
  });
});
