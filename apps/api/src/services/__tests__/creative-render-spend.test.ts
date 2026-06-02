/**
 * P2a-iii — the render-cost producer. `creative.job.continue` past storyboard
 * triggers the paid render; this computes that render's dollar cost from the
 * persisted storyboard + chosen tier so it can be surfaced as the governance
 * spend signal (`spendAmount`) that the spend-approval threshold reads. The cost
 * is derived server-side from the storyboard — the operator picks the tier but
 * cannot spoof the amount.
 */
import { describe, it, expect, vi } from "vitest";

const { estimateCost } = vi.hoisted(() => ({
  estimateCost: vi.fn().mockReturnValue({ basic: { cost: 5 }, pro: { cost: 12 } }),
}));
vi.mock("@switchboard/creative-pipeline", () => ({ estimateCost }));

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
