// AgentTask terminal-status transition for the UGC creative runner.
// Mirrors creative-job-runner-task-status.test.ts (polished runner equivalent).
// The runner spawns an AgentTask via the creative-job-submit workflow but
// historically never settled it, so every UGC job left a "pending" task
// polluting the open-task work-log + metrics. These tests pin the injected
// updater being called on each in-band terminal branch (complete => completed;
// stop / approval timeout => cancelled) and that a failing updater never
// throws out of the runner.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeUgcPipeline } from "../ugc/ugc-job-runner.js";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

vi.mock("../inngest-client.js", () => ({
  inngestClient: {
    createFunction: createFunctionSpy,
    schemas: new Map(),
  },
}));

// Programmable production phase: the default (zero assets) matches what the
// real phase produces with this file's empty creator pool.
const { executeProductionPhaseMock } = vi.hoisted(() => ({
  executeProductionPhaseMock: vi
    .fn()
    .mockResolvedValue({ assets: [], qaResults: {}, failedSpecs: [] }),
}));
vi.mock("../ugc/phases/production.js", () => ({
  executeProductionPhase: executeProductionPhaseMock,
}));

function createMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
    // Default: every approval gate returns "continue" (all 4 phases run)
    waitForEvent: vi.fn(() => ({ data: { action: "continue", phase: "planning" } })),
    sendEvent: vi.fn(),
  };
}

function createMockDeps(
  updateTaskStatus?: (organizationId: string, taskId: string, status: string) => Promise<void>,
) {
  return {
    jobStore: {
      findById: vi.fn<(id: string) => unknown>(),
      updateUgcPhase:
        vi.fn<
          (orgId: string, id: string, phase: string, outputs: Record<string, unknown>) => unknown
        >(),
      stopUgc: vi.fn<(orgId: string, id: string, phase: string) => unknown>(),
      failUgc:
        vi.fn<
          (orgId: string, id: string, phase: string, error: Record<string, unknown>) => unknown
        >(),
      setDurableAsset: vi.fn<(orgId: string, id: string, url: string) => unknown>(),
    },
    creatorStore: {
      findByDeployment: vi.fn<(deploymentId: string) => unknown>().mockResolvedValue([]),
    },
    deploymentStore: {
      findById: vi
        .fn<(id: string) => unknown>()
        .mockResolvedValue({ listing: { trustScore: 80 }, type: "standard" }),
    },
    ...(updateTaskStatus !== undefined ? { updateTaskStatus } : {}),
  };
}

describe("executeUgcPipeline AgentTask terminal-status transition", () => {
  let step: ReturnType<typeof createMockStep>;

  const eventData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  // Trust 80 skips all approval gates so we hit "complete" in a single loop pass.
  const mockUgcJob = {
    id: "job_1",
    deploymentId: "dep_1",
    mode: "ugc",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcConfig: {},
    stoppedAt: null,
    ugcFailure: null,
  };

  beforeEach(() => {
    step = createMockStep();
    executeProductionPhaseMock.mockResolvedValue({ assets: [], qaResults: {}, failedSpecs: [] });
  });

  it("marks the AgentTask completed via the injected updater when the pipeline finishes", async () => {
    const updateTaskStatus = vi.fn<
      (organizationId: string, taskId: string, status: string) => Promise<void>
    >(async () => {});
    const deps = createMockDeps(updateTaskStatus);
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);

    await executeUgcPipeline(eventData, step as never, deps as never);

    // The terminal "complete" branch transitions the spawned AgentTask off
    // "pending" so it stops polluting the open-task work-log.
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "completed");
  });

  it("marks the AgentTask cancelled via the injected updater when the buyer stops the pipeline", async () => {
    // Trust 0 requires approval at each gate. First gate: continue; second: stop.
    const stopStep = createMockStep();
    stopStep.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue", phase: "planning" } })
      .mockResolvedValueOnce({ data: { action: "stop", phase: "scripting" } } as never);

    const updateTaskStatus = vi.fn<
      (organizationId: string, taskId: string, status: string) => Promise<void>
    >(async () => {});
    const deps = createMockDeps(updateTaskStatus);
    // Trust 0 forces approval at every phase gate.
    deps.deploymentStore.findById.mockResolvedValue({
      listing: { trustScore: 0 },
      type: "standard",
    });
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);
    deps.jobStore.stopUgc.mockResolvedValue(mockUgcJob);

    await executeUgcPipeline(eventData, stopStep as never, deps as never);

    // A stop (explicit stop action) is a terminal halt: the task must not linger
    // as "pending".
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "cancelled");
  });

  it("marks the AgentTask cancelled via the injected updater on approval timeout (null)", async () => {
    const timeoutStep = createMockStep();
    timeoutStep.waitForEvent.mockResolvedValueOnce(null as never);

    const updateTaskStatus = vi.fn<
      (organizationId: string, taskId: string, status: string) => Promise<void>
    >(async () => {});
    const deps = createMockDeps(updateTaskStatus);
    // Trust 0 forces approval at every phase gate.
    deps.deploymentStore.findById.mockResolvedValue({
      listing: { trustScore: 0 },
      type: "standard",
    });
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);
    deps.jobStore.stopUgc.mockResolvedValue(mockUgcJob);

    await executeUgcPipeline(eventData, timeoutStep as never, deps as never);

    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "cancelled");
  });

  it("never blocks the pipeline when the task updater rejects (best-effort)", async () => {
    const updateTaskStatus = vi
      .fn<(organizationId: string, taskId: string, status: string) => Promise<void>>()
      .mockRejectedValue(new Error("task store down"));
    const deps = createMockDeps(updateTaskStatus);
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);

    // A failed task-status write must not throw out of the runner (which would
    // re-run all paid phases on Inngest retry); the job already reached complete.
    await expect(
      executeUgcPipeline(eventData, step as never, deps as never),
    ).resolves.toBeUndefined();
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "completed");
  });

  it("is a no-op when no updater is injected (backward compat with existing callers)", async () => {
    // No updateTaskStatus in deps — no error, pipeline runs normally.
    const deps = createMockDeps();
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);

    await expect(
      executeUgcPipeline(eventData, step as never, deps as never),
    ).resolves.toBeUndefined();
  });
});
