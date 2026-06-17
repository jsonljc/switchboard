// AgentTask terminal-status transition for the polished creative runner.
// Split out of creative-job-runner.test.ts (which is at the 600-line max-lines
// cap). The runner spawns an AgentTask via the creative-job-submit workflow but
// historically never settled it, so every job left a "pending" task polluting
// the open-task work-log + metrics. These tests pin the injected updater being
// called on each in-band terminal branch (complete => completed; stop / approval
// timeout => cancelled) and that a failing updater never throws out of the runner.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreativePipeline } from "../creative-job-runner.js";

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

// Mock runStage so tests don't import the real stage implementations (which need Anthropic SDK).
vi.mock("../stages/run-stage.js", async () => {
  const actual =
    await vi.importActual<typeof import("../stages/run-stage.js")>("../stages/run-stage.js");
  return {
    ...actual,
    runStage: vi.fn().mockResolvedValue({ placeholder: true }),
  };
});

vi.mock("../stages/image-generator.js", () => ({
  DalleImageGenerator: vi.fn(() => ({
    generate: vi.fn().mockResolvedValue("https://dalle.example.com/mock.png"),
  })),
}));

function createMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(
      () => ({ data: { action: "continue" } }) as { data: { action: string } } | null,
    ),
  };
}

// Typed mocks: the ARGUMENT signatures are what matter (an arg-less vi.fn() types
// mock.calls as an empty tuple and trips TS2493 when tsc compiles the tests at
// build time). The return is `unknown` so a sync or async implementation satisfies it.
function createMockJobStore() {
  return {
    findById: vi.fn<(id: string) => unknown>(),
    updateStage:
      vi.fn<
        (orgId: string, id: string, stage: string, outputs: Record<string, unknown>) => unknown
      >(),
    stop: vi.fn<(orgId: string, id: string, stoppedAt: string) => unknown>(),
    setDurableAsset: vi.fn<(orgId: string, id: string, url: string) => unknown>(),
    completeWithAsset:
      vi.fn<
        (
          orgId: string,
          id: string,
          stage: string,
          outputs: Record<string, unknown>,
          durableAssetUrl: string,
        ) => unknown
      >(),
  };
}

describe("executeCreativePipeline AgentTask terminal-status transition", () => {
  let step: ReturnType<typeof createMockStep>;
  let jobStore: ReturnType<typeof createMockJobStore>;
  const llmConfig = { apiKey: "test-key" };

  const jobData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const mockJob = {
    id: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
    productDescription: "AI scheduling tool",
    targetAudience: "Small business owners",
    platforms: ["meta"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    currentStage: "trends",
    stageOutputs: {},
    stoppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    step = createMockStep();
    jobStore = createMockJobStore();
    jobStore.findById.mockResolvedValue(mockJob);
    jobStore.updateStage.mockImplementation((_orgId, _id, stage, outputs) => ({
      ...mockJob,
      currentStage: stage,
      stageOutputs: outputs,
    }));
  });

  it("marks the AgentTask completed via the injected updater when the pipeline finishes", async () => {
    const updateTaskStatus =
      vi.fn<(organizationId: string, taskId: string, status: string) => Promise<void>>();
    await executeCreativePipeline(
      jobData,
      step as never,
      jobStore as never,
      llmConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      updateTaskStatus,
    );
    // The terminal "complete" branch transitions the spawned AgentTask off
    // "pending" so it stops polluting the open-task work-log.
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "completed");
  });

  it("marks the AgentTask cancelled via the injected updater when the buyer stops the pipeline", async () => {
    step.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue" } })
      .mockResolvedValueOnce({ data: { action: "stop" } });
    const updateTaskStatus =
      vi.fn<(organizationId: string, taskId: string, status: string) => Promise<void>>();
    await executeCreativePipeline(
      jobData,
      step as never,
      jobStore as never,
      llmConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      updateTaskStatus,
    );
    // A stop (explicit stop action OR 24h approval timeout) is a terminal halt:
    // the task must not linger as "pending".
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "cancelled");
  });

  it("marks the AgentTask cancelled via the injected updater on approval timeout", async () => {
    step.waitForEvent.mockResolvedValueOnce(null);
    const updateTaskStatus =
      vi.fn<(organizationId: string, taskId: string, status: string) => Promise<void>>();
    await executeCreativePipeline(
      jobData,
      step as never,
      jobStore as never,
      llmConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      updateTaskStatus,
    );
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "cancelled");
  });

  it("never blocks the pipeline when the task updater rejects (best-effort)", async () => {
    const updateTaskStatus = vi
      .fn<(organizationId: string, taskId: string, status: string) => Promise<void>>()
      .mockRejectedValue(new Error("task store down"));
    // A failed task-status write must not throw out of the runner (which would
    // re-run all paid stages on Inngest retry); the job already reached complete.
    await expect(
      executeCreativePipeline(
        jobData,
        step as never,
        jobStore as never,
        llmConfig,
        undefined,
        undefined,
        undefined,
        undefined,
        updateTaskStatus,
      ),
    ).resolves.toBeUndefined();
    expect(updateTaskStatus).toHaveBeenCalledWith("org_1", "task_1", "completed");
  });
});
