import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeModeDispatch, createModeDispatcher } from "../mode-dispatcher.js";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("inngest", () => ({
  Inngest: vi.fn().mockImplementation(() => ({
    createFunction: createFunctionSpy,
    schemas: new Map(),
  })),
}));

function createMockStep() {
  return {
    sendEvent: vi.fn(),
  };
}

describe("executeModeDispatch", () => {
  let step: ReturnType<typeof createMockStep>;

  const baseEvent = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  beforeEach(() => {
    step = createMockStep();
  });

  it("dispatches to UGC runner when mode is 'ugc'", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "ugc" }, step as never);

    expect(step.sendEvent).toHaveBeenCalledWith("dispatch-ugc", {
      name: "creative-pipeline/ugc.submitted",
      data: expect.objectContaining({
        jobId: "job_1",
        mode: "ugc",
        pipelineVersion: "ugc_v2",
      }),
    });
  });

  it("dispatches to polished runner when mode is 'polished'", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "polished" }, step as never);

    expect(step.sendEvent).toHaveBeenCalledWith("dispatch-polished", {
      name: "creative-pipeline/polished.submitted",
      data: expect.objectContaining({
        jobId: "job_1",
        mode: "polished",
      }),
    });
  });

  it("defaults to polished when mode is not specified", async () => {
    await executeModeDispatch(baseEvent, step as never);

    expect(step.sendEvent).toHaveBeenCalledWith("dispatch-polished", {
      name: "creative-pipeline/polished.submitted",
      data: expect.objectContaining({
        mode: "polished",
      }),
    });
  });
});

// ---------------------------------------------------------------------------
// JSON-safe step payload (SPINE-7 / BUG-6)
// ---------------------------------------------------------------------------
// Inngest serializes the event payload to JSON for step memoization / replay.
// A `Date` instance is not a JSON primitive, so it does not survive a
// round-trip as the same type (it becomes a string, or null under some
// serializers). The dispatch must emit an ISO string so downstream UGC /
// polished runners read a stable, JSON-safe `dispatchedAt`.
describe("executeModeDispatch — JSON-safe step payload (SPINE-7 / BUG-6)", () => {
  let step: ReturnType<typeof createMockStep>;
  const baseEvent = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  beforeEach(() => {
    step = createMockStep();
  });

  function dispatchedData(): Record<string, unknown> {
    const call = step.sendEvent.mock.calls[0]!;
    return (call[1] as { data: Record<string, unknown> }).data;
  }

  it("ugc: dispatchedAt is an ISO string that survives a JSON round-trip unchanged", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "ugc" }, step as never);
    const data = dispatchedData();
    expect(typeof data["dispatchedAt"]).toBe("string");
    expect(data["dispatchedAt"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // A Date round-trips to a string (not identity); an ISO string is identity.
    const roundTripped = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    expect(roundTripped["dispatchedAt"]).toBe(data["dispatchedAt"]);
  });

  it("polished: dispatchedAt is an ISO string, never a Date instance", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "polished" }, step as never);
    const data = dispatchedData();
    expect(data["dispatchedAt"] instanceof Date).toBe(false);
    expect(typeof data["dispatchedAt"]).toBe("string");
  });

  it("no value in the dispatched payload is a Date instance (JSON-safety invariant)", async () => {
    await executeModeDispatch({ ...baseEvent, mode: "ugc" }, step as never);
    for (const v of Object.values(dispatchedData())) {
      expect(v instanceof Date).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createModeDispatcher
// ---------------------------------------------------------------------------

describe("createModeDispatcher — onFailure wiring", () => {
  it("passes onFailure callback into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createModeDispatcher(onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createModeDispatcher();

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });
});
