import { describe, it, expect, vi } from "vitest";

const { inngestCreateFunction } = vi.hoisted(() => ({
  inngestCreateFunction: vi.fn((_cfg: unknown, _handler: unknown) => ({
    id: "creative-failure-recorder",
  })),
}));
vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { createFunction: inngestCreateFunction },
}));

const { executeCreativeFailureRecorder, CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS } =
  await import("../creative-failure-recorder.js");

/** step.run mock: invokes the callback and returns its value (no Inngest memoization). */
const step = { run: async (_id: string, fn: () => unknown) => fn() } as never;

function makeDeps(job: Record<string, unknown> | null) {
  return {
    jobStore: {
      findById: vi.fn(async (): Promise<unknown> => job),
      failPolished: vi.fn(async (): Promise<unknown> => ({})),
      failUgc: vi.fn(async (): Promise<unknown> => ({})),
    },
  };
}

const polishedEvent = {
  trigger: { jobId: "job_1" },
  code: "ASYNC_JOB_FAILED",
  message: "boom",
  functionId: "creative-job-runner",
  occurredAt: "2026-06-11T00:00:00.000Z",
};

describe("executeCreativeFailureRecorder", () => {
  it("records a polished failure via failPolished using the loaded job's org", async () => {
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      mode: "polished",
      currentStage: "hooks",
      stageOutputs: {},
    });
    await executeCreativeFailureRecorder(polishedEvent, step, deps as never);
    expect(deps.jobStore.failPolished).toHaveBeenCalledWith(
      "org_1",
      "job_1",
      expect.objectContaining({ kind: "terminal", code: "ASYNC_JOB_FAILED", message: "boom" }),
    );
    expect(deps.jobStore.failUgc).not.toHaveBeenCalled();
  });

  it("records a ugc failure via failUgc at the job's current phase", async () => {
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      mode: "ugc",
      ugcPhase: "scripting",
    });
    await executeCreativeFailureRecorder(
      { ...polishedEvent, functionId: "ugc-job-runner" },
      step,
      deps as never,
    );
    expect(deps.jobStore.failUgc).toHaveBeenCalledWith(
      "org_1",
      "job_1",
      "scripting",
      expect.objectContaining({ kind: "terminal" }),
    );
    expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
  });

  it("defaults the ugc phase to planning when ugcPhase is null", async () => {
    const deps = makeDeps({ id: "job_1", organizationId: "org_1", mode: "ugc", ugcPhase: null });
    await executeCreativeFailureRecorder(
      { ...polishedEvent, functionId: "ugc-job-runner" },
      step,
      deps as never,
    );
    expect(deps.jobStore.failUgc).toHaveBeenCalledWith(
      "org_1",
      "job_1",
      "planning",
      expect.any(Object),
    );
  });

  it("skips a job that is already terminally failed (stageFailure set)", async () => {
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      mode: "polished",
      stageFailure: { code: "X" },
    });
    await executeCreativeFailureRecorder(polishedEvent, step, deps as never);
    expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
  });

  it("skips a stopped job", async () => {
    const deps = makeDeps({
      id: "job_1",
      organizationId: "org_1",
      mode: "polished",
      stoppedAt: "hooks",
    });
    await executeCreativeFailureRecorder(polishedEvent, step, deps as never);
    expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
  });

  it("skips when the dead-letter carries no jobId", async () => {
    const deps = makeDeps(null);
    await executeCreativeFailureRecorder({ code: "X" }, step, deps as never);
    expect(deps.jobStore.findById).not.toHaveBeenCalled();
  });

  it("skips when the job is not found", async () => {
    const deps = makeDeps(null);
    await executeCreativeFailureRecorder(polishedEvent, step, deps as never);
    expect(deps.jobStore.failPolished).not.toHaveBeenCalled();
    expect(deps.jobStore.failUgc).not.toHaveBeenCalled();
  });
});

describe("CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS", () => {
  it("is a Class-E contract: audit-only, no event recursion, no alert", () => {
    expect(CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS).toMatchObject({
      functionId: "creative-failure-recorder",
      alert: false,
      emitEvent: false,
    });
  });
});
