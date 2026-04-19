import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeModeDispatch } from "../mode-dispatcher.js";

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
