/**
 * P2a-ii — `creative.job.continue` / `creative.job.stop` workflow handlers.
 *
 * After routing /creative-jobs/:id/approve through PlatformIngress, the
 * ownership check, productionTier persist, `jobStore.stop`, and the
 * stage/ugc-phase Inngest event ALL live here (post-governance), not on the
 * route. These tests lock that behaviour — most importantly the cross-org
 * isolation guarantee that previously lived in the route-level ownership test:
 * a mismatched org → failed CREATIVE_JOB_NOT_FOUND with NO mutation and NO
 * Inngest event.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { findById, updateProductionTier, stop, stopUgc, inngestSend } = vi.hoisted(() => ({
  findById: vi.fn(),
  updateProductionTier: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  stopUgc: vi.fn().mockResolvedValue(undefined),
  inngestSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@switchboard/db", () => ({
  PrismaCreativeJobStore: class {
    findById = findById;
    updateProductionTier = updateProductionTier;
    stop = stop;
    stopUgc = stopUgc;
  },
}));

vi.mock("@switchboard/creative-pipeline", () => ({
  inngestClient: { send: inngestSend },
}));

const { buildCreativeJobDecisionWorkflow } = await import("../creative-job-decision-workflow.js");

const ORG = "org-owner";
const JOB_ID = "job-1";

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    organizationId: ORG,
    currentStage: "storyboard",
    stoppedAt: null,
    mode: "polished",
    ugcPhase: null,
    ...overrides,
  };
}

function workUnit(parameters: Record<string, unknown>, organizationId = ORG) {
  return {
    id: "wu-1",
    organizationId,
    actor: { id: "user-1", type: "user" as const },
    intent: "creative.job.continue",
    parameters,
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "creative",
      trustLevel: "guided" as const,
      trustScore: 0,
    },
    resolvedMode: "workflow" as const,
    traceId: "trace-1",
    trigger: "api" as const,
    priority: "normal" as const,
    requestedAt: new Date("2026-06-02").toISOString(),
  };
}

const services = { submitChildWork: vi.fn() };

describe("creative.job.continue / stop workflow", () => {
  beforeEach(() => {
    findById.mockReset();
    updateProductionTier.mockClear();
    stop.mockClear();
    stopUgc.mockClear();
    inngestSend.mockClear();
  });

  // ── Cross-org isolation (the lock migrated from the route) ──────────────────
  it("cross-org continue → failed CREATIVE_JOB_NOT_FOUND, NO mutation, NO event", async () => {
    findById.mockResolvedValue(makeJob()); // job is owned by ORG
    const handler = buildCreativeJobDecisionWorkflow({}, "continue");

    const res = await handler.execute(workUnit({ jobId: JOB_ID }, "org-intruder"), services);

    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_JOB_NOT_FOUND");
    expect(updateProductionTier).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("cross-org stop → failed CREATIVE_JOB_NOT_FOUND, NO stop, NO event", async () => {
    findById.mockResolvedValue(makeJob());
    const handler = buildCreativeJobDecisionWorkflow({}, "stop");

    const res = await handler.execute(workUnit({ jobId: JOB_ID }, "org-intruder"), services);

    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_JOB_NOT_FOUND");
    expect(stop).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("missing job → failed CREATIVE_JOB_NOT_FOUND", async () => {
    findById.mockResolvedValue(null);
    const res = await buildCreativeJobDecisionWorkflow({}, "continue").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_JOB_NOT_FOUND");
  });

  it("complete/stopped job → failed CREATIVE_JOB_NOT_AWAITING_APPROVAL", async () => {
    findById.mockResolvedValue(makeJob({ currentStage: "complete" }));
    const res = await buildCreativeJobDecisionWorkflow({}, "continue").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CREATIVE_JOB_NOT_AWAITING_APPROVAL");
    expect(updateProductionTier).not.toHaveBeenCalled();
  });

  // ── Owner happy paths ───────────────────────────────────────────────────────
  it("owner continue at storyboard → persists productionTier, fires stage.approved continue, queued/approved", async () => {
    findById.mockResolvedValue(makeJob({ currentStage: "storyboard" }));
    const res = await buildCreativeJobDecisionWorkflow({}, "continue").execute(
      workUnit({ jobId: JOB_ID, productionTier: "pro" }),
      services,
    );

    expect(updateProductionTier).toHaveBeenCalledWith(ORG, JOB_ID, "pro");
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/stage.approved",
      data: { jobId: JOB_ID, action: "continue" },
    });
    expect(res.outcome).toBe("queued");
    expect(res.outputs).toMatchObject({ action: "approved" });
  });

  it("owner continue defaults productionTier to basic at storyboard", async () => {
    findById.mockResolvedValue(makeJob({ currentStage: "storyboard" }));
    await buildCreativeJobDecisionWorkflow({}, "continue").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );
    expect(updateProductionTier).toHaveBeenCalledWith(ORG, JOB_ID, "basic");
  });

  it("owner continue past storyboard does NOT touch productionTier", async () => {
    findById.mockResolvedValue(makeJob({ currentStage: "production" }));
    await buildCreativeJobDecisionWorkflow({}, "continue").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );
    expect(updateProductionTier).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/stage.approved",
      data: { jobId: JOB_ID, action: "continue" },
    });
  });

  it("owner stop → calls jobStore.stop, fires stage.approved stop, queued/stopped", async () => {
    findById.mockResolvedValue(makeJob({ currentStage: "hooks" }));
    const res = await buildCreativeJobDecisionWorkflow({}, "stop").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );

    expect(stop).toHaveBeenCalledWith(ORG, JOB_ID, "hooks");
    expect(stopUgc).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/stage.approved",
      data: { jobId: JOB_ID, action: "stop" },
    });
    expect(res.outputs).toMatchObject({ action: "stopped" });
  });

  // ── UGC mode emits the phase-scoped event ───────────────────────────────────
  it("ugc continue → fires ugc-phase.approved with the job's phase", async () => {
    findById.mockResolvedValue(
      makeJob({ mode: "ugc", ugcPhase: "production", currentStage: "production" }),
    );
    await buildCreativeJobDecisionWorkflow({}, "continue").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/ugc-phase.approved",
      data: { jobId: JOB_ID, phase: "production", action: "continue" },
    });
  });

  it("ugc stop → calls stopUgc (NOT polished stop) and fires ugc-phase.approved stop", async () => {
    findById.mockResolvedValue(makeJob({ mode: "ugc", ugcPhase: "concept" }));
    await buildCreativeJobDecisionWorkflow({}, "stop").execute(
      workUnit({ jobId: JOB_ID }),
      services,
    );
    // A ugc job stops via stopUgc(phase), not the polished stop(currentStage) — else a
    // polished-stage value lands in the ugc phase column until the worker self-corrects.
    expect(stopUgc).toHaveBeenCalledWith(ORG, JOB_ID, "concept");
    expect(stop).not.toHaveBeenCalled();
    expect(inngestSend).toHaveBeenCalledWith({
      name: "creative-pipeline/ugc-phase.approved",
      data: { jobId: JOB_ID, phase: "concept", action: "stop" },
    });
  });
});
