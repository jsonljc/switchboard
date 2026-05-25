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
