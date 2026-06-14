import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeUgcPipeline, createUgcJobRunner } from "../ugc/ugc-job-runner.js";

// Hoist the spy so it's available when vi.mock factory runs.
const { createFunctionSpy } = vi.hoisted(() => ({
  createFunctionSpy: vi.fn().mockReturnValue({}),
}));

// ugc-job-runner imports inngestClient from "../inngest-client.js" (relative to src/ugc/).
// From this test file (src/__tests__/), that resolves to src/inngest-client.ts.
vi.mock("../inngest-client.js", () => ({
  inngestClient: {
    createFunction: createFunctionSpy,
    schemas: new Map(),
  },
}));

// Programmable production phase: the default (zero assets) matches what the
// real phase produces with this file's empty creator pool; durable-asset
// tests override per case.
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
    waitForEvent: vi.fn(() => ({ data: { action: "continue", phase: "planning" } })),
    sendEvent: vi.fn(),
  };
}

function createMockDeps() {
  return {
    jobStore: {
      findById: vi.fn(),
      updateUgcPhase: vi.fn(),
      stopUgc: vi.fn(),
      failUgc: vi.fn(),
      setDurableAsset: vi.fn(),
    },
    creatorStore: { findByDeployment: vi.fn().mockResolvedValue([]) },
    deploymentStore: {
      findById: vi.fn().mockResolvedValue({ listing: { trustScore: 0 }, type: "standard" }),
    },
  };
}

describe("executeUgcPipeline", () => {
  let step: ReturnType<typeof createMockStep>;
  let deps: ReturnType<typeof createMockDeps>;

  const eventData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  const mockUgcJob = {
    id: "job_1",
    deploymentId: "dep_1",
    mode: "ugc",
    ugcPhase: null,
    ugcPhaseOutputs: null,
    ugcConfig: {},
  };

  beforeEach(() => {
    step = createMockStep();
    deps = createMockDeps();
    deps.jobStore.findById.mockResolvedValue(mockUgcJob);
    deps.jobStore.updateUgcPhase.mockResolvedValue(mockUgcJob);
  });

  it("runs all 4 phases when approval is granted at each gate", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    // load-job + preload-context + 4 phase runs + 4 saves = 10 step.run calls
    expect(step.run).toHaveBeenCalledTimes(10);

    // 4 phase completion events + 1 final completed event = 5 sendEvent calls
    expect(step.sendEvent).toHaveBeenCalledTimes(5);

    // 4 approval waits (one per phase, trust=0 requires all)
    expect(step.waitForEvent).toHaveBeenCalledTimes(4);

    // Final event is ugc.completed
    const lastSendCall = step.sendEvent.mock.calls[4]!;
    expect(lastSendCall[1]).toMatchObject({
      name: "creative-pipeline/ugc.completed",
    });
  });

  it("stops pipeline when approval returns stop", async () => {
    step.waitForEvent
      .mockResolvedValueOnce({ data: { action: "continue", phase: "planning" } })
      .mockResolvedValueOnce({ data: { action: "stop", phase: "scripting" } } as never);

    await executeUgcPipeline(eventData, step as never, deps as never);

    // load-job + preload + planning run + save + scripting run + save + stop = 7
    expect(step.run).toHaveBeenCalledTimes(7);
    expect(deps.jobStore.stopUgc).toHaveBeenCalledWith("org_1", "job_1", "scripting");
  });

  it("stops pipeline on approval timeout (null)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null as never);

    await executeUgcPipeline(eventData, step as never, deps as never);

    expect(deps.jobStore.stopUgc).toHaveBeenCalledWith("org_1", "job_1", "planning");
  });

  it("throws if job not found", async () => {
    deps.jobStore.findById.mockResolvedValue(null);

    await expect(executeUgcPipeline(eventData, step as never, deps as never)).rejects.toThrow(
      "UGC job not found: job_1",
    );
  });

  it("resumes from last completed phase", async () => {
    const resumeJob = {
      ...mockUgcJob,
      ugcPhase: "scripting",
      ugcPhaseOutputs: { planning: { done: true } },
    };
    deps.jobStore.findById.mockResolvedValue(resumeJob);

    await executeUgcPipeline(eventData, step as never, deps as never);

    // load-job + preload + scripting run + save + production run + save + delivery run + save = 8
    // (skips planning entirely)
    expect(step.run).toHaveBeenCalledTimes(8);

    // Verify first phase run is scripting, not planning
    const phaseRunCalls = step.run.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].startsWith("phase-"),
    );
    expect(phaseRunCalls[0]![0]).toBe("phase-scripting");
  });

  it("skips approval gates when trust level is high enough", async () => {
    // Trust 80 meets all thresholds (planning=55, scripting=55, production=80, delivery=80)
    deps.deploymentStore.findById.mockResolvedValue({
      listing: { trustScore: 80 },
      type: "standard",
    });

    await executeUgcPipeline(eventData, step as never, deps as never);

    // 0 approval waits — trust 80 meets all thresholds
    expect(step.waitForEvent).toHaveBeenCalledTimes(0);
  });

  it("emits ugc-phase.completed event after each phase", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    const phaseCompleteEvents = step.sendEvent.mock.calls.filter(
      (c) => c[1]?.name === "creative-pipeline/ugc-phase.completed",
    );
    expect(phaseCompleteEvents).toHaveLength(4);
    expect(phaseCompleteEvents[0]![1].data.phase).toBe("planning");
    expect(phaseCompleteEvents[1]![1].data.phase).toBe("scripting");
    expect(phaseCompleteEvents[2]![1].data.phase).toBe("production");
    expect(phaseCompleteEvents[3]![1].data.phase).toBe("delivery");
  });

  it("matches approval events on jobId ONLY (polished parity; slice-3 spec 3.3a)", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    // The decision workflow emits phase = the PERSISTED ugcPhase, which the
    // runner sets to the NEXT phase before waiting; a phase `if` filter can
    // therefore never match a governed approve (the latent bug this pins
    // against). Waits are sequential (one active wait per job), so jobId-only
    // matching cannot skip a later gate.
    for (const call of step.waitForEvent.mock.calls) {
      const opts = (call as unknown[])[1] as Record<string, unknown>;
      expect(opts).toMatchObject({
        event: "creative-pipeline/ugc-phase.approved",
        match: "data.jobId",
      });
      expect(opts.if).toBeUndefined();
    }
  });

  it("promotes the first non-rejected asset's durable url to the job (slice-3 spec 3.3f)", async () => {
    executeProductionPhaseMock.mockResolvedValueOnce({
      assets: [
        { approvalState: "rejected", durableAssetUrl: undefined, outputs: {} },
        {
          approvalState: "approved",
          durableAssetUrl: "https://durable.example.com/creative-assets/job_1/ugc-s2.mp4",
          outputs: {},
        },
      ],
      qaResults: {},
      failedSpecs: [],
    });
    await executeUgcPipeline(eventData, step as never, deps as never);
    expect(deps.jobStore.setDurableAsset).toHaveBeenCalledWith(
      "org_1",
      "job_1",
      "https://durable.example.com/creative-assets/job_1/ugc-s2.mp4",
    );
  });

  it("does not set a durable url when no non-rejected asset carries one", async () => {
    executeProductionPhaseMock.mockResolvedValueOnce({
      assets: [{ approvalState: "rejected", durableAssetUrl: undefined, outputs: {} }],
      qaResults: {},
      failedSpecs: [{ specId: "s1", reason: "qa_failed" }],
    });
    await executeUgcPipeline(eventData, step as never, deps as never);
    expect(deps.jobStore.setDurableAsset).not.toHaveBeenCalled();
  });

  it("a decision-workflow-shaped emit (persisted NEXT phase) resumes the wait", async () => {
    // Simulate exactly what creative-job-decision-workflow sends after the
    // planning gate: phase carries the persisted value ("scripting"), not the
    // awaited phase. With jobId-only matching this resumes; with the old
    // phase filter it timed out into stopUgc after 24h.
    step.waitForEvent.mockResolvedValue({
      data: { action: "continue", phase: "scripting" },
    } as never);
    await executeUgcPipeline(eventData, step as never, deps as never);
    expect(deps.jobStore.stopUgc).not.toHaveBeenCalled();
    expect(deps.jobStore.updateUgcPhase).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// D5-F2: replay / duplicate-delivery integrity. A re-delivered or operator-
// replayed ugc.submitted against a terminal (or unknown-phase) job must be a
// clean no-op: no lifecycle mutation, no paid phase re-run, no approval park,
// no throw. Without the guard, ugcPhase "complete" => indexOf(-1) => the loop
// runs at i=-1 (phase undefined) and persists "planning" OVER "complete".
// ---------------------------------------------------------------------------
describe("executeUgcPipeline: replay/terminal integrity [D5-F2]", () => {
  let step: ReturnType<typeof createMockStep>;
  let deps: ReturnType<typeof createMockDeps>;

  const eventData = {
    jobId: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
  };

  beforeEach(() => {
    step = createMockStep();
    deps = createMockDeps();
    executeProductionPhaseMock.mockClear();
  });

  function expectNoMutationNoSpend() {
    // No lifecycle writes
    expect(deps.jobStore.updateUgcPhase).not.toHaveBeenCalled();
    expect(deps.jobStore.stopUgc).not.toHaveBeenCalled();
    expect(deps.jobStore.failUgc).not.toHaveBeenCalled();
    expect(deps.jobStore.setDurableAsset).not.toHaveBeenCalled();
    // No spend: the production phase executor is never invoked
    expect(executeProductionPhaseMock).not.toHaveBeenCalled();
    // No spurious approval park, no emitted events
    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(step.sendEvent).not.toHaveBeenCalled();
    // Only load-job ran (no preload-context, no phase loop)
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(step.run.mock.calls[0]![0]).toBe("load-job");
  }

  it("no-ops on a completed job (ugcPhase=complete): the indexOf(-1) regression", async () => {
    deps.jobStore.findById.mockResolvedValue({
      id: "job_1",
      deploymentId: "dep_1",
      mode: "ugc",
      ugcPhase: "complete",
      ugcPhaseOutputs: { planning: {}, scripting: {}, production: {}, delivery: {} },
      ugcConfig: {},
      stoppedAt: null,
      ugcFailure: null,
    } as never);

    await expect(
      executeUgcPipeline(eventData, step as never, deps as never),
    ).resolves.toBeUndefined();
    expectNoMutationNoSpend();
  });

  it("no-ops on a stopped job (stoppedAt set, valid phase)", async () => {
    deps.jobStore.findById.mockResolvedValue({
      id: "job_1",
      deploymentId: "dep_1",
      mode: "ugc",
      ugcPhase: "scripting",
      ugcPhaseOutputs: { planning: {} },
      ugcConfig: {},
      stoppedAt: "scripting",
      ugcFailure: null,
    } as never);

    await expect(
      executeUgcPipeline(eventData, step as never, deps as never),
    ).resolves.toBeUndefined();
    expectNoMutationNoSpend();
  });

  it("no-ops on a failed job (ugcFailure set)", async () => {
    deps.jobStore.findById.mockResolvedValue({
      id: "job_1",
      deploymentId: "dep_1",
      mode: "ugc",
      ugcPhase: "production",
      ugcPhaseOutputs: { planning: {}, scripting: {} },
      ugcConfig: {},
      stoppedAt: null,
      ugcFailure: { kind: "terminal", code: "PHASE_EXECUTION_FAILED" },
    } as never);

    await expect(
      executeUgcPipeline(eventData, step as never, deps as never),
    ).resolves.toBeUndefined();
    expectNoMutationNoSpend();
  });

  it("no-ops on an unrecognized phase (indexOf < 0, not a known terminal)", async () => {
    deps.jobStore.findById.mockResolvedValue({
      id: "job_1",
      deploymentId: "dep_1",
      mode: "ugc",
      ugcPhase: "frobnicate",
      ugcPhaseOutputs: { planning: {} },
      ugcConfig: {},
      stoppedAt: null,
      ugcFailure: null,
    } as never);

    await expect(
      executeUgcPipeline(eventData, step as never, deps as never),
    ).resolves.toBeUndefined();
    expectNoMutationNoSpend();
  });
});

// ---------------------------------------------------------------------------
// onFailure wiring — createUgcJobRunner (Class B, emitEvent:false)
// ---------------------------------------------------------------------------

describe("createUgcJobRunner — onFailure wiring", () => {
  function makeMinimalDeps() {
    return {
      jobStore: { findById: vi.fn(), updateUgcPhase: vi.fn(), stopUgc: vi.fn(), failUgc: vi.fn() },
      creatorStore: { findByDeployment: vi.fn().mockResolvedValue([]) },
      deploymentStore: { findById: vi.fn().mockResolvedValue(null) },
    };
  }

  it("passes onFailure into createFunction config when provided", () => {
    createFunctionSpy.mockClear();
    const onFailure = async (_arg: unknown) => {};
    createUgcJobRunner(makeMinimalDeps() as never, onFailure);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof config?.["onFailure"]).toBe("function");
  });

  it("does not set onFailure key when no callback provided", () => {
    createFunctionSpy.mockClear();
    createUgcJobRunner(makeMinimalDeps() as never);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["onFailure"]).toBeUndefined();
  });

  it("declares jobId idempotency on the created function (D5-F2 duplicate-delivery dedup)", () => {
    createFunctionSpy.mockClear();
    createUgcJobRunner(makeMinimalDeps() as never);

    const config = createFunctionSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config?.["idempotency"]).toBe("event.data.jobId");
  });
});
