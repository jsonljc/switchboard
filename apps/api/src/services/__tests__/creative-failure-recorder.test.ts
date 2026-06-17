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

describe("executeCreativeFailureRecorder AgentTask terminal transition", () => {
  function makeDepsWithTask(
    job: Record<string, unknown> | null,
    updateTaskStatus: ReturnType<typeof vi.fn>,
  ) {
    return {
      jobStore: {
        findById: vi.fn(async (): Promise<unknown> => job),
        failPolished: vi.fn(async (): Promise<unknown> => ({})),
        failUgc: vi.fn(async (): Promise<unknown> => ({})),
      },
      updateTaskStatus,
    };
  }

  it("marks the spawned AgentTask failed after recording a polished failure", async () => {
    const updateTaskStatus = vi.fn<
      (organizationId: string, taskId: string, status: "failed") => Promise<void>
    >(async () => {});
    const deps = makeDepsWithTask(
      {
        id: "job_1",
        taskId: "task_1",
        organizationId: "org_1",
        mode: "polished",
        currentStage: "hooks",
        stageOutputs: {},
      },
      updateTaskStatus,
    );
    await executeCreativeFailureRecorder(polishedEvent, step, deps as never);
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "failed");
  });

  it("marks the spawned AgentTask failed after recording a ugc failure", async () => {
    const updateTaskStatus = vi.fn<
      (organizationId: string, taskId: string, status: "failed") => Promise<void>
    >(async () => {});
    const deps = makeDepsWithTask(
      {
        id: "job_1",
        taskId: "task_1",
        organizationId: "org_1",
        mode: "ugc",
        ugcPhase: "scripting",
      },
      updateTaskStatus,
    );
    await executeCreativeFailureRecorder(
      { ...polishedEvent, functionId: "ugc-job-runner" },
      step,
      deps as never,
    );
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "failed");
  });

  it("does not touch the AgentTask when the job is already terminal (skipped)", async () => {
    const updateTaskStatus = vi.fn<
      (organizationId: string, taskId: string, status: "failed") => Promise<void>
    >(async () => {});
    const deps = makeDepsWithTask(
      {
        id: "job_1",
        taskId: "task_1",
        organizationId: "org_1",
        mode: "polished",
        stageFailure: { code: "X" },
      },
      updateTaskStatus,
    );
    await executeCreativeFailureRecorder(polishedEvent, step, deps as never);
    expect(updateTaskStatus).not.toHaveBeenCalled();
  });

  it("never throws when the AgentTask updater rejects (Class-E: no recursion)", async () => {
    const updateTaskStatus = vi
      .fn<(organizationId: string, taskId: string, status: "failed") => Promise<void>>()
      .mockRejectedValue(new Error("task store down"));
    const deps = makeDepsWithTask(
      {
        id: "job_1",
        taskId: "task_1",
        organizationId: "org_1",
        mode: "polished",
        currentStage: "hooks",
        stageOutputs: {},
      },
      updateTaskStatus,
    );
    await expect(
      executeCreativeFailureRecorder(polishedEvent, step, deps as never),
    ).resolves.toBeUndefined();
    expect(deps.jobStore.failPolished).toHaveBeenCalled();
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "failed");
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
