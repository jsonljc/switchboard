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

    // 1 load-job + 1 load-production-tier + 5 stage runs + 5 save calls = 12 step.run calls
    // + 4 waitForEvent calls (no wait after production)
    expect(step.run).toHaveBeenCalledTimes(12);
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
      // Pins the runner-layer threading for whisper: production captions need
      // the OPENAI key on the StageInput (toMatchObject elsewhere would let a
      // dropped thread pass silently).
      openaiApiKey: "test-openai-key",
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
    try {
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
    } finally {
      // Restore the shared module-level mock so later tests see the default.
      mockRunStage.mockReset();
      mockRunStage.mockResolvedValue({ placeholder: true });
    }
  });

  it("does not persist durableAssetUrl when production output lacks one", async () => {
    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);
    expect(jobStore.setDurableAsset).not.toHaveBeenCalled();
  });

  it("threads the injected klingClient into the production stage input", async () => {
    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockClear();
    mockRunStage.mockResolvedValue({ placeholder: true });

    const klingClient = { generateVideo: vi.fn() };
    await executeCreativePipeline(
      jobData,
      step as never,
      jobStore as never,
      llmConfig,
      undefined,
      undefined,
      undefined,
      klingClient,
    );

    const productionCall = mockRunStage.mock.calls.find((c) => c[0] === "production");
    expect((productionCall?.[1] as { klingClient?: unknown }).klingClient).toBe(klingClient);
  });

  it("forwards an injected klingClient through the created runner handler into production", async () => {
    createFunctionSpy.mockClear();
    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockClear();
    mockRunStage.mockResolvedValue({ placeholder: true });

    const klingClient = { generateVideo: vi.fn() };
    createCreativeJobRunner(
      jobStore as never,
      llmConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      klingClient,
    );
    const handler = createFunctionSpy.mock.calls[0]?.[1] as (arg: {
      event: { data: typeof jobData };
      step: typeof step;
    }) => Promise<void>;
    await handler({ event: { data: jobData }, step });

    const productionCall = mockRunStage.mock.calls.find((c) => c[0] === "production");
    expect((productionCall?.[1] as { klingClient?: unknown }).klingClient).toBe(klingClient);
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

  it("declares jobId idempotency on the created function (D5-F2 duplicate-delivery dedup)", () => {
    createFunctionSpy.mockClear();
    createCreativeJobRunner(mockJobStore as never, llmConf);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["idempotency"]).toBe("event.data.jobId");
  });
});

describe("slice-2 feed-back threading (taste provider + measured history)", () => {
  const llmConfig = { apiKey: "test-key" };
  const jobData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const HISTORY = {
    kind: "performance_history",
    version: 1,
    generatedAt: "2026-06-04T12:00:00.000Z",
    topPerformers: [
      {
        jobId: "older-job",
        descriptor: "polished:question",
        trueRoas: 5,
        spend: 50,
        bookedValueCents: 25000,
        window: { from: "2026-05-05T00:00:00.000Z", to: "2026-06-04T06:30:00.000Z" },
      },
    ],
    summary: "1 measured creative(s) on this deployment; top by trueROAS listed.",
  };

  function baseJob(pastPerformance: unknown) {
    return {
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
      pastPerformance,
      generateReferenceImages: false,
      currentStage: "trends",
      stageOutputs: {},
      stoppedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function mkStep() {
    return {
      run: vi.fn((_name: string, fn: () => unknown) => fn()),
      waitForEvent: vi.fn(
        () => ({ data: { action: "continue" } }) as { data: { action: string } } | null,
      ),
    };
  }

  function mkStore(pastPerformance: unknown) {
    const job = baseJob(pastPerformance);
    return {
      findById: vi.fn().mockResolvedValue(job),
      updateStage: vi.fn().mockImplementation((_o, _i, stage, outputs) => ({
        ...job,
        currentStage: stage,
        stageOutputs: outputs,
      })),
      stop: vi.fn(),
      setDurableAsset: vi.fn(),
    };
  }

  async function stageBriefOfFirstCall() {
    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    const firstCall = mockRunStage.mock.calls[0];
    return firstCall?.[1] as {
      brief: { pastPerformance?: unknown; tasteContext?: string[] };
    };
  }

  it("threads a parsed performance_history row and provider taste lines into the stage brief", async () => {
    const { runStage } = await import("../stages/run-stage.js");
    (runStage as ReturnType<typeof vi.fn>).mockClear();
    const provider = {
      getTasteContext: vi
        .fn()
        .mockResolvedValue(["consistently keeps question hooks in polished mode (4 keeps)"]),
    };

    await executeCreativePipeline(
      jobData,
      mkStep() as never,
      mkStore(HISTORY) as never,
      llmConfig,
      undefined,
      undefined,
      provider,
    );

    expect(provider.getTasteContext).toHaveBeenCalledWith("org_1", "dep_1");
    const input = await stageBriefOfFirstCall();
    expect(input.brief.pastPerformance).toMatchObject({ kind: "performance_history" });
    expect(input.brief.tasteContext).toEqual([
      "consistently keeps question hooks in polished mode (4 keeps)",
    ]);
  });

  it("a measured_performance row does NOT thread (disjoint kind fails the history parse)", async () => {
    const { runStage } = await import("../stages/run-stage.js");
    (runStage as ReturnType<typeof vi.fn>).mockClear();
    const measured = { kind: "measured_performance", version: 1 }; // partial; parse fails either way

    await executeCreativePipeline(
      jobData,
      mkStep() as never,
      mkStore(measured) as never,
      llmConfig,
    );

    const input = await stageBriefOfFirstCall();
    expect(input.brief.pastPerformance).toBeUndefined();
  });

  it("provider failure degrades to no taste block, never fails the render", async () => {
    const { runStage } = await import("../stages/run-stage.js");
    (runStage as ReturnType<typeof vi.fn>).mockClear();
    const provider = { getTasteContext: vi.fn().mockRejectedValue(new Error("memory db down")) };

    await expect(
      executeCreativePipeline(
        jobData,
        mkStep() as never,
        mkStore(null) as never,
        llmConfig,
        undefined,
        undefined,
        provider,
      ),
    ).resolves.toBeUndefined();

    const input = await stageBriefOfFirstCall();
    expect(input.brief.tasteContext).toBeUndefined();
  });

  it("absent provider changes nothing (no extra step.run)", async () => {
    const step = mkStep();
    await executeCreativePipeline(jobData, step as never, mkStore(null) as never, llmConfig);
    // 1 load-job + 1 load-production-tier + 5 stage runs + 5 saves = 12
    expect(step.run).toHaveBeenCalledTimes(12);
  });
});

// ---------------------------------------------------------------------------
// D1-F2 regression: the operator's production-tier choice is written AFTER the
// load-job snapshot is memoized, so the production stage must re-read it from
// authoritative state instead of the snapshot. The default createMockStep is
// pass-through (no replay memoization), which is precisely why this defect went
// untested; this block memoizes step outputs the way Inngest replays them.
// ---------------------------------------------------------------------------
describe("productionTier propagation: replay-safe re-read [D1-F2]", () => {
  const llmConfig = { apiKey: "test-key" };
  const jobData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  // Inngest memoizes each step's first-run output and replays it verbatim. A
  // stale-snapshot read passes under a pass-through mock but fails here, because
  // a correct fix must observe state written after load-job was memoized, and
  // must do so under a fresh, distinctly-named step (reusing "load-job" returns
  // the cached null and fails this test too).
  function createReplayStep() {
    const memo = new Map<string, unknown>();
    return {
      run: vi.fn(async (name: string, fn: () => unknown) => {
        if (memo.has(name)) return memo.get(name);
        const result = await fn();
        memo.set(name, result);
        return result;
      }),
      waitForEvent: vi.fn(
        async () => ({ data: { action: "continue" } }) as { data: { action: string } } | null,
      ),
    };
  }

  it("renders the tier persisted after the load-job snapshot, not stale basic", async () => {
    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockClear();
    mockRunStage.mockResolvedValue({ placeholder: true });

    // Invariant: load-job is memoized with productionTier null; before production
    // begins the persisted row reads "pro"; production must use the fresh value.
    // The storyboard-gate decision persists the tier once currentStage advances
    // to "storyboard", i.e. when the scripts output is saved, which is the
    // updateStage(stage: "storyboard") call below.
    let dbTier: "basic" | "pro" | null = null;
    const findById = vi.fn(async () => ({
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
      productionTier: dbTier, // read at call time → the load-job snapshot stays null
      stoppedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const jobStore = {
      findById,
      updateStage: vi.fn(
        async (_org: string, _id: string, stage: string, outputs: Record<string, unknown>) => {
          if (stage === "storyboard") dbTier = "pro";
          return { id: "job_1", currentStage: stage, stageOutputs: outputs };
        },
      ),
      stop: vi.fn(),
      setDurableAsset: vi.fn(),
    };

    await executeCreativePipeline(
      jobData,
      createReplayStep() as never,
      jobStore as never,
      llmConfig,
    );

    const productionCall = mockRunStage.mock.calls.find((call) => call[0] === "production");
    expect(productionCall).toBeDefined();
    expect((productionCall?.[1] as { productionTier?: string }).productionTier).toBe("pro");
  });
});

// ---------------------------------------------------------------------------
// D5-F2: replay / duplicate-delivery integrity. A re-delivered or operator-
// replayed polished.submitted against a terminal (complete/stopped/failed) job
// must be a clean no-op: no lifecycle mutation, no paid stage re-run, no
// approval park, no throw. The stage loop restarts at STAGE_ORDER[0] on every
// fresh invocation, so without the guard a duplicate re-runs the trends stage
// (LLM spend) and overwrites currentStage "complete" => "hooks".
// ---------------------------------------------------------------------------
describe("executeCreativePipeline: replay/terminal integrity [D5-F2]", () => {
  let step: ReturnType<typeof createMockStep>;
  let jobStore: ReturnType<typeof createMockJobStore>;
  const llmConfig = { apiKey: "test-key" };
  const jobData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const base = {
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
    stageOutputs: { trends: {}, hooks: {}, scripts: {}, storyboard: {}, production: {} },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    step = createMockStep();
    jobStore = createMockJobStore();
    const { runStage } = await import("../stages/run-stage.js");
    const mockRunStage = runStage as ReturnType<typeof vi.fn>;
    mockRunStage.mockClear();
    mockRunStage.mockResolvedValue({ placeholder: true });
  });

  async function expectNoMutationNoSpend() {
    const { runStage } = await import("../stages/run-stage.js");
    expect(runStage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(jobStore.updateStage).not.toHaveBeenCalled();
    expect(jobStore.stop).not.toHaveBeenCalled();
    expect(jobStore.setDurableAsset).not.toHaveBeenCalled();
    expect(step.waitForEvent).not.toHaveBeenCalled();
    // Only load-job ran (no load-taste-context, no stage loop)
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(step.run.mock.calls[0]![0]).toBe("load-job");
  }

  it("no-ops on a completed job (currentStage=complete): the STAGE_ORDER-from-0 regression", async () => {
    jobStore.findById.mockResolvedValue({ ...base, currentStage: "complete", stoppedAt: null });

    await expect(
      executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig),
    ).resolves.toBeUndefined();
    await expectNoMutationNoSpend();
  });

  it("no-ops on a stopped job (stoppedAt set)", async () => {
    jobStore.findById.mockResolvedValue({ ...base, currentStage: "hooks", stoppedAt: "hooks" });

    await expect(
      executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig),
    ).resolves.toBeUndefined();
    await expectNoMutationNoSpend();
  });

  it("no-ops on a failed job (stageFailure set)", async () => {
    jobStore.findById.mockResolvedValue({
      ...base,
      currentStage: "production",
      stoppedAt: null,
      stageFailure: { code: "RENDER_FAILED" },
    });

    await expect(
      executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig),
    ).resolves.toBeUndefined();
    await expectNoMutationNoSpend();
  });

  it("still runs a brand-new job (currentStage=trends): the guard does not over-trigger", async () => {
    jobStore.findById.mockResolvedValue({
      ...base,
      currentStage: "trends",
      stageOutputs: {},
      stoppedAt: null,
    });
    jobStore.updateStage.mockImplementation((_o, _i, stage, outputs) => ({
      ...base,
      currentStage: stage,
      stageOutputs: outputs,
    }));

    await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig);

    const { runStage } = await import("../stages/run-stage.js");
    expect(runStage as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(jobStore.updateStage).toHaveBeenCalled();
  });
});
