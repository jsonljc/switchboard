// packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreativePipeline, createCreativeJobRunner } from "../creative-job-runner.js";

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

// Mock runStage so tests don't import the real stage implementations (which need Anthropic SDK)
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

function createMockJobStore() {
  return {
    findById: vi.fn(),
    updateStage: vi.fn(),
    stop: vi.fn(),
    setDurableAsset: vi.fn(),
  };
}

describe("executeCreativePipeline", () => {
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

  it("runs all 5 stages when buyer approves each", async () => {
    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    // 1 load-job + 5 stage runs + 5 save calls = 11 step.run calls
    // + 4 waitForEvent calls (no wait after production)
    expect(step.run).toHaveBeenCalledTimes(11);
    expect(step.waitForEvent).toHaveBeenCalledTimes(4);
  });

  it("stops pipeline when buyer sends stop action", async () => {
    // Approve trends, then stop at hooks
    step.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue" } })
      .mockResolvedValueOnce({ data: { action: "stop" } });

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    // 1 load-job + trends run + save + hooks run + save + stop = 6 step.runs
    expect(step.run).toHaveBeenCalledTimes(6);
    expect(step.waitForEvent).toHaveBeenCalledTimes(2);
    expect(jobStore.stop).toHaveBeenCalledWith("org_1", "job_1", "hooks");
  });

  it("stops pipeline on waitForEvent timeout (null event)", async () => {
    // First wait returns null (timeout)
    step.waitForEvent.mockResolvedValueOnce(null);

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    // 1 load-job + trends run + save + stop = 4 step.runs, 1 waitForEvent
    expect(step.run).toHaveBeenCalledTimes(4);
    expect(jobStore.stop).toHaveBeenCalledWith("org_1", "job_1", "trends");
  });

  it("throws if job not found", async () => {
    jobStore.findById.mockResolvedValue(null);

    await expect(
      executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig),
    ).rejects.toThrow("Creative job not found: job_1");
  });

  it("passes imageConfig through when job has generateReferenceImages", async () => {
    const jobWithImages = { ...mockJob, generateReferenceImages: true };

    // Reset the mock and set the new return value
    jobStore.findById.mockReset();
    jobStore.findById.mockResolvedValue(jobWithImages);

    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockClear(); // Clear previous calls

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig, {
      openaiApiKey: "test-openai-key",
    });

    // Verify that runStage was called with generateReferenceImages and imageGenerator
    // All stages should receive these fields
    const firstCall = mockRunStage.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[1]).toMatchObject({
      generateReferenceImages: true,
      imageGenerator: expect.objectContaining({ generate: expect.any(Function) }),
    });
  });

  it("does not create imageGenerator when openaiApiKey not set", async () => {
    const jobWithImages = { ...mockJob, generateReferenceImages: true };

    // Reset the mock and set the new return value
    jobStore.findById.mockReset();
    jobStore.findById.mockResolvedValue(jobWithImages);

    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockClear(); // Clear previous calls

    await executeCreativePipeline(
      jobData,
      step as never,
      jobStore as never,
      llmConfig,
      // no openaiApiKey
    );

    const firstCall = mockRunStage.mock.calls[0];
    expect(firstCall?.[1]?.imageGenerator).toBeUndefined();
  });

  it("persists durableAssetUrl after production when the output carries one", async () => {
    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockImplementation((stage: string) =>
      stage === "production"
        ? { durableAssetUrl: "https://cdn.example.com/creative-assets/job_1/u.mp4" }
        : { placeholder: true },
    );

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    expect(jobStore.setDurableAsset).toHaveBeenCalledTimes(1);
    expect(jobStore.setDurableAsset).toHaveBeenCalledWith(
      "org_1",
      "job_1",
      "https://cdn.example.com/creative-assets/job_1/u.mp4",
    );

    mockRunStage.mockReset();
    mockRunStage.mockResolvedValue({ placeholder: true });
  });

  it("does not persist durableAssetUrl when production output lacks one", async () => {
    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);
    expect(jobStore.setDurableAsset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createCreativeJobRunner (Class B)
// ---------------------------------------------------------------------------

describe("createCreativeJobRunner — onFailure wiring", () => {
  const mockJobStore = {
    findById: vi.fn(),
    updateStage: vi.fn(),
    stop: vi.fn(),
    setDurableAsset: vi.fn(),
  };
  const llmConf = { apiKey: "test-key" };

  it("passes onFailure into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createCreativeJobRunner(mockJobStore as never, llmConf, undefined, undefined, onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createCreativeJobRunner(mockJobStore as never, llmConf);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });
});
