import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeUgcPipeline } from "../ugc/ugc-job-runner.js";

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
    expect(deps.jobStore.stopUgc).toHaveBeenCalledWith("job_1", "scripting");
  });

  it("stops pipeline on approval timeout (null)", async () => {
    step.waitForEvent.mockResolvedValueOnce(null as never);

    await executeUgcPipeline(eventData, step as never, deps as never);

    expect(deps.jobStore.stopUgc).toHaveBeenCalledWith("job_1", "planning");
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

  it("matches approval event on both jobId and phase", async () => {
    await executeUgcPipeline(eventData, step as never, deps as never);

    const firstWait = step.waitForEvent.mock.calls[0]!;
    expect((firstWait as unknown[])[1]).toMatchObject({
      event: "creative-pipeline/ugc-phase.approved",
      match: "data.jobId",
    });
    // The `if` clause should filter by phase
    expect(((firstWait as unknown[])[1] as Record<string, unknown>).if).toContain("planning");
  });
});
