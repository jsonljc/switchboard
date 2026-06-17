import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import {
  buildRecommendationHandoffWorkflow,
  type RecommendationHandoffDeps,
} from "../recommendation-handoff-workflow.js";

function wu(parameters: Record<string, unknown>): WorkUnit {
  return {
    id: "wu_handoff_1",
    organizationId: "org_x",
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.recommendation.handoff",
    parameters,
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

const goodParams = {
  recommendationId: "rec_1",
  actionType: "refresh_creative",
  campaignId: "camp_1",
  rationale: "creative fatigue",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
  learningPhaseActive: false,
  brief: { productDescription: "Botox refresh", targetAudience: "women 30-45" },
};

/**
 * A default `markRecommendationActed` spy that reports a clean transition, typed
 * to the dep signature so tsc-over-tests (which builds the api package) keeps
 * `mock.calls[0]` argument access honest. Tests that assert call arguments pass
 * their own spy; tests that only care about the workflow outcome reuse this.
 */
function actedSpy(
  result: Awaited<ReturnType<RecommendationHandoffDeps["markRecommendationActed"]>> = {
    transitioned: true,
  },
): RecommendationHandoffDeps["markRecommendationActed"] {
  return vi.fn<RecommendationHandoffDeps["markRecommendationActed"]>().mockResolvedValue(result);
}

const FIXED_NOW = new Date("2026-06-17T12:00:00.000Z");

function deps(
  markRecommendationActed: RecommendationHandoffDeps["markRecommendationActed"] = actedSpy(),
): RecommendationHandoffDeps {
  return { markRecommendationActed, now: () => FIXED_NOW };
}

describe("buildRecommendationHandoffWorkflow", () => {
  it("submits a creative.concept.draft child on a routable, well-evidenced handoff", async () => {
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { jobId: "job_9" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("completed");
    expect(submitChildWork).toHaveBeenCalledTimes(1);
    const arg = submitChildWork.mock.calls[0]![0];
    expect(arg.intent).toBe("creative.concept.draft");
    expect(arg.actor).toEqual({ id: "system", type: "system" });
    expect(arg.idempotencyKey).toBe("handoff-draft:rec_1:refresh_creative");
    expect(arg.parameters.brief.productDescription).toBe("Botox refresh");
  });

  it("threads Riley's diagnosis into the child draft brief as structured data (D6-3)", async () => {
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { jobId: "job_9" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps());
    await handler.execute(wu(goodParams), { submitChildWork });
    const brief = submitChildWork.mock.calls[0]![0].parameters.brief;
    // The diagnosis reaches Mira AS DATA (routable), built from the validated handoff input.
    expect(brief.rileyDiagnosis).toEqual({
      campaignId: "camp_1",
      actionType: "refresh_creative",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    });
    // Back-compat: the existing brief fields still flow unchanged.
    expect(brief.productDescription).toBe("Botox refresh");
    expect(brief.targetAudience).toBe("women 30-45");
  });

  it("transitions the SOURCE recommendation to acted after a successful handoff draft", async () => {
    // The reason this slice exists: outcome attribution must be able to tell an
    // acted-on recommendation from an ignored one. A created draft IS the act.
    const markRecommendationActed = actedSpy();
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { jobId: "job_9" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps(markRecommendationActed));
    const res = await handler.execute(wu(goodParams), { submitChildWork });

    expect(res.outcome).toBe("completed");
    expect(markRecommendationActed).toHaveBeenCalledTimes(1);
    expect(markRecommendationActed).toHaveBeenCalledWith({
      organizationId: "org_x",
      // The SOURCE recommendation id, not the child draft id.
      recommendationId: "rec_1",
      // The handoff work unit is the executable that did the act.
      executableWorkUnitId: "wu_handoff_1",
      executedAt: FIXED_NOW,
    });
    expect(res.outputs?.recommendationTransition).toBe("acted");
  });

  it("does NOT transition the source recommendation when the handoff abstains", async () => {
    // Abstention is a deliberate no-op: nothing was acted on, so the source
    // recommendation must stay pending (an ignored rec, not an acted one).
    const markRecommendationActed = actedSpy();
    const submitChildWork = vi.fn();
    const handler = buildRecommendationHandoffWorkflow(deps(markRecommendationActed));
    const res = await handler.execute(
      wu({ ...goodParams, evidence: { clicks: 1, conversions: 0, days: 1 } }),
      { submitChildWork },
    );
    expect(res.outputs?.abstained).toBe(true);
    expect(submitChildWork).not.toHaveBeenCalled();
    expect(markRecommendationActed).not.toHaveBeenCalled();
  });

  it("does NOT transition the source recommendation when no draft was created (no jobId)", async () => {
    // A completed-but-skipped child (Mira not enabled) created no draft, so the
    // recommendation was not acted on; it must not be marked acted.
    const markRecommendationActed = actedSpy();
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { skipped: true, reason: "mira_not_enabled" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps(markRecommendationActed));
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outputs?.skipped).toBe(true);
    expect(markRecommendationActed).not.toHaveBeenCalled();
  });

  it("does NOT transition the source recommendation when the child draft fails", async () => {
    const markRecommendationActed = actedSpy();
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "DEPLOYMENT_NOT_FOUND", message: "no creative deployment" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps(markRecommendationActed));
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("failed");
    expect(markRecommendationActed).not.toHaveBeenCalled();
  });

  it("never fails the unit when the acted transition throws (bookkeeping only)", async () => {
    // The child draft is the execution truth the operator was promised. A
    // transition failure is recorded in outputs and logged, never converted into
    // a false "failed" claim about a draft that really was created.
    const markRecommendationActed = vi
      .fn<RecommendationHandoffDeps["markRecommendationActed"]>()
      .mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { jobId: "job_9" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps(markRecommendationActed));
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("completed");
    expect((res.outputs as { jobId?: string }).jobId).toBe("job_9");
    expect(res.outputs?.recommendationTransition).toBe("error");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("records not_found (benign) when the source recommendation cannot be transitioned", async () => {
    const markRecommendationActed = actedSpy({ transitioned: false, reason: "not_found" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { jobId: "job_9" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps(markRecommendationActed));
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("completed");
    expect(res.outputs?.recommendationTransition).toBe("not_found");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("abstains (no child) when below the evidence floor", async () => {
    const submitChildWork = vi.fn();
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(
      wu({ ...goodParams, evidence: { clicks: 1, conversions: 0, days: 1 } }),
      { submitChildWork },
    );
    expect(res.outcome).toBe("completed");
    expect(res.outputs?.abstained).toBe(true);
    expect(res.outputs?.reason).toBe("below_evidence_floor");
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("abstains as unroutable_action for a non-creative action", async () => {
    const submitChildWork = vi.fn();
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu({ ...goodParams, actionType: "pause" }), {
      submitChildWork,
    });
    expect(res.outputs?.abstained).toBe(true);
    expect(res.outputs?.reason).toBe("unroutable_action");
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("fails closed with INVALID_HANDOFF on a malformed payload", async () => {
    const submitChildWork = vi.fn();
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu({ recommendationId: "" }), { submitChildWork });
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("INVALID_HANDOFF");
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("reports CHILD_DRAFT_FAILED when the child submit fails", async () => {
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "DEPLOYMENT_NOT_FOUND", message: "no creative deployment" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CHILD_DRAFT_FAILED");
  });

  it("reports CHILD_DRAFT_FAILED when the child returns ok:true but a failed outcome", async () => {
    // PlatformIngress returns ok:true with result.outcome:"failed" when the child
    // workflow executes but fails (e.g. the draft handler's DEPLOYMENT_NOT_FOUND).
    // The parent must NOT report this as a phantom success.
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "failed",
        error: { code: "DEPLOYMENT_NOT_FOUND", message: "no creative deployment" },
      },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("CHILD_DRAFT_FAILED");
  });

  it("fails closed: a learning-resetting action with NO learningPhaseActive flag abstains as learning_locked", async () => {
    // Defense in depth: refresh_creative resets learning. If the learningPhaseActive
    // signal is dropped from the payload, default to "assume learning is active" and
    // abstain - never create a learning-resetting draft on missing information.
    const submitChildWork = vi.fn();
    const { learningPhaseActive: _drop, ...noFlag } = goodParams;
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu(noFlag), { submitChildWork });
    expect(res.outputs?.abstained).toBe(true);
    expect(res.outputs?.reason).toBe("learning_locked");
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("does not report a created draft when the child completed but skipped (no jobId)", async () => {
    // The draft workflow returns completed + { skipped: true } (no jobId) when Mira
    // is not enabled for the org. The handoff must report the skip honestly, never a
    // phantom "routed" success.
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { skipped: true, reason: "mira_not_enabled" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow(deps());
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("completed");
    expect(res.outputs?.skipped).toBe(true);
    expect(res.outputs?.reason).toBe("mira_not_enabled");
    expect((res.outputs as { jobId?: string }).jobId).toBeUndefined();
  });
});
