import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import { buildRecommendationHandoffWorkflow } from "../recommendation-handoff-workflow.js";

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

describe("buildRecommendationHandoffWorkflow", () => {
  it("submits a creative.concept.draft child on a routable, well-evidenced handoff", async () => {
    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { jobId: "job_9" } },
      workUnit: { id: "wu_child" },
    });
    const handler = buildRecommendationHandoffWorkflow();
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("completed");
    expect(submitChildWork).toHaveBeenCalledTimes(1);
    const arg = submitChildWork.mock.calls[0]![0];
    expect(arg.intent).toBe("creative.concept.draft");
    expect(arg.actor).toEqual({ id: "system", type: "system" });
    expect(arg.idempotencyKey).toBe("handoff-draft:rec_1:refresh_creative");
    expect(arg.parameters.brief.productDescription).toBe("Botox refresh");
  });

  it("abstains (no child) when below the evidence floor", async () => {
    const submitChildWork = vi.fn();
    const handler = buildRecommendationHandoffWorkflow();
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
    const handler = buildRecommendationHandoffWorkflow();
    const res = await handler.execute(wu({ ...goodParams, actionType: "pause" }), {
      submitChildWork,
    });
    expect(res.outputs?.abstained).toBe(true);
    expect(res.outputs?.reason).toBe("unroutable_action");
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("fails closed with INVALID_HANDOFF on a malformed payload", async () => {
    const submitChildWork = vi.fn();
    const handler = buildRecommendationHandoffWorkflow();
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
    const handler = buildRecommendationHandoffWorkflow();
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
    const handler = buildRecommendationHandoffWorkflow();
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
    const handler = buildRecommendationHandoffWorkflow();
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
    const handler = buildRecommendationHandoffWorkflow();
    const res = await handler.execute(wu(goodParams), { submitChildWork });
    expect(res.outcome).toBe("completed");
    expect(res.outputs?.skipped).toBe(true);
    expect(res.outputs?.reason).toBe("mira_not_enabled");
    expect((res.outputs as { jobId?: string }).jobId).toBeUndefined();
  });
});
