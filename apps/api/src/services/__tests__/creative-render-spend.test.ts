/**
 * P2a-iii — the render-cost producer. `creative.job.continue` past storyboard
 * triggers the paid render; this computes that render's dollar cost from the
 * persisted storyboard + chosen tier so it can be surfaced as the governance
 * spend signal (`spendAmount`) that the spend-approval threshold reads. The cost
 * is derived server-side from the storyboard — the operator picks the tier but
 * cannot spoof the amount.
 */
import { describe, it, expect, vi } from "vitest";

const { estimateCost, estimateUgcCost } = vi.hoisted(() => ({
  estimateCost: vi.fn().mockReturnValue({ basic: { cost: 5 }, pro: { cost: 12 } }),
  estimateUgcCost: vi.fn().mockReturnValue({ cost: 0.7, description: "2 UGC clips via kling" }),
}));
vi.mock("@switchboard/creative-pipeline", () => ({ estimateCost, estimateUgcCost }));

const { computeRenderSpend } = await import("../creative-render-spend.js");

const jobWithStoryboard = {
  stageOutputs: {
    storyboard: { storyboards: [{ scenes: [{ duration: 5 }] }] },
    scripts: { scripts: [{}, {}] },
  },
};

describe("computeRenderSpend", () => {
  it("returns null before the storyboard exists (no paid render imminent)", async () => {
    expect(await computeRenderSpend({ stageOutputs: {} }, "pro")).toBeNull();
    expect(await computeRenderSpend({ stageOutputs: null }, "pro")).toBeNull();
    expect(await computeRenderSpend({}, "pro")).toBeNull();
  });

  it("returns the chosen tier's render cost from the estimate", async () => {
    expect(await computeRenderSpend(jobWithStoryboard, "pro")).toBe(12);
    expect(await computeRenderSpend(jobWithStoryboard, "basic")).toBe(5);
  });

  it("defaults to the basic tier when none is given (mirrors the workflow default)", async () => {
    expect(await computeRenderSpend(jobWithStoryboard, undefined)).toBe(5);
  });

  it("passes the script count through to the estimator", async () => {
    await computeRenderSpend(jobWithStoryboard, "pro");
    expect(estimateCost).toHaveBeenLastCalledWith(jobWithStoryboard.stageOutputs.storyboard, 2);
  });

  it("returns null for a non-positive estimate (nothing to spend)", async () => {
    estimateCost.mockReturnValueOnce({ basic: { cost: 0 }, pro: { cost: 0 } });
    expect(await computeRenderSpend(jobWithStoryboard, "pro")).toBeNull();
  });
});

describe("computeRenderSpend, UGC leg (slice-3 spec 3.3b)", () => {
  const specs = [
    { renderTargets: { durationSec: 5 }, providersAllowed: ["kling"] },
    { renderTargets: { durationSec: 8 }, providersAllowed: ["kling"] },
  ];
  const ugcJob = (overrides: Record<string, unknown> = {}) => ({
    mode: "ugc",
    ugcPhase: "production",
    ugcFailure: null,
    stoppedAt: null,
    ugcPhaseOutputs: { scripting: { specs } },
    stageOutputs: {},
    ...overrides,
  });

  it("attaches spend ONLY at the approve-into-production gate (ugcPhase production)", async () => {
    expect(await computeRenderSpend(ugcJob(), undefined)).toBe(0.7);
    expect(estimateUgcCost).toHaveBeenLastCalledWith(specs);
  });

  it("returns null before scripting output exists (planning gate)", async () => {
    expect(
      await computeRenderSpend(ugcJob({ ugcPhase: "scripting", ugcPhaseOutputs: {} }), undefined),
    ).toBeNull();
  });

  it("returns null at the production gate (ugcPhase delivery): money already spent", async () => {
    // Specs are still present after production runs; attaching spend to the
    // delivery-advance approve would park the operator for spent money.
    expect(await computeRenderSpend(ugcJob({ ugcPhase: "delivery" }), undefined)).toBeNull();
  });

  it("returns null for failed or stopped jobs that still carry ugcPhase production", async () => {
    expect(await computeRenderSpend(ugcJob({ ugcFailure: { code: "X" } }), undefined)).toBeNull();
    expect(await computeRenderSpend(ugcJob({ stoppedAt: "production" }), undefined)).toBeNull();
  });

  it("ignores the tier for ugc (untiered)", async () => {
    expect(await computeRenderSpend(ugcJob(), "pro")).toBe(0.7);
  });

  it("estimate readback fills BOTH tier slots with the single untiered estimate", async () => {
    // The dashboard reads estimates.basic.cost; populating both slots keeps
    // the existing reader numerically correct (3.4 only suppresses the tier
    // picker). Readback is informational: no phase gating, specs suffice.
    const { computeCreativeEstimates } = await import("../creative-render-spend.js");
    const est = await computeCreativeEstimates(ugcJob({ ugcPhase: "delivery" }));
    expect(est?.basic).toEqual({ cost: 0.7, description: "2 UGC clips via kling" });
    expect(est?.pro).toEqual(est?.basic);
  });

  it("estimate readback null for ugc before scripting output exists", async () => {
    const { computeCreativeEstimates } = await import("../creative-render-spend.js");
    expect(await computeCreativeEstimates(ugcJob({ ugcPhaseOutputs: {} }))).toBeNull();
  });
});
