// Cost estimation: the single source for the governance spend signal and the
// estimate readback (slice-3 spec 3.3b adds the UGC leg). The provider
// router's internal ranking costs must agree with these constants, or the
// production budget accumulator and the governance estimate diverge.
import { describe, it, expect } from "vitest";
import {
  estimateCost,
  estimateUgcCost,
  KLING_COST_PER_5S,
  KLING_COST_PER_10S,
  HEYGEN_COST_PER_CLIP,
} from "../stages/cost-estimator.js";
import { ESTIMATED_COST } from "../ugc/provider-router.js";

describe("estimateCost (polished, pre-existing contract)", () => {
  it("prices basic as duration-mapped kling per scene per script", () => {
    const storyboard = {
      storyboards: [{ scenes: [{ duration: 4 }, { duration: 8 }] }],
    };
    const est = estimateCost(storyboard, 2);
    // (0.35 + 0.70) x 2 scripts
    expect(est.basic.cost).toBeCloseTo(2.1, 2);
  });
});

describe("estimateUgcCost (slice-3 spec 3.3b)", () => {
  it("prices each spec by duration-mapped kling rates", () => {
    const est = estimateUgcCost([
      { renderTargets: { durationSec: 5 }, providersAllowed: ["kling"] },
      { renderTargets: { durationSec: 8 }, providersAllowed: ["kling"] },
    ]);
    expect(est.cost).toBeCloseTo(KLING_COST_PER_5S + KLING_COST_PER_10S, 2);
    expect(est.description).toBe("2 UGC clips via kling");
  });

  it("uses the SAME duration boundary the kling adapter renders with (<=7s renders 5s)", () => {
    // mapDuration in video-provider.ts renders <=7s specs as 5s clips; the
    // estimate must bill the same bucket or governance over-states 2x for
    // 5-7s clips (scripting's midpoint sums commonly land there).
    const est = estimateUgcCost([
      { renderTargets: { durationSec: 6 }, providersAllowed: ["kling"] },
    ]);
    expect(est.cost).toBeCloseTo(KLING_COST_PER_5S, 2);
  });

  it("returns a zero estimate for zero specs", () => {
    const est = estimateUgcCost([]);
    expect(est.cost).toBe(0);
    expect(est.description).toBe("No clips to produce");
  });

  it("bills avatar-capable specs at the MAX across allowed providers (conservative parking)", () => {
    // a heygen-allowed talking-head spec MAY render on heygen: governance
    // parks on the dearest allowed rate so the operator never under-approves.
    const est = estimateUgcCost([
      { renderTargets: { durationSec: 12 }, providersAllowed: ["kling", "heygen"] },
    ]);
    expect(est.cost).toBeCloseTo(Math.max(KLING_COST_PER_10S, HEYGEN_COST_PER_CLIP), 2);
    expect(est.description).toBe("1 UGC clips via heygen, kling");
  });
});

describe("cost-table parity (governance signal vs production budget accumulator)", () => {
  it("the router's kling ranking cost equals the estimator's per-clip base rate", () => {
    expect(ESTIMATED_COST.kling).toBe(KLING_COST_PER_5S);
  });

  it("the router's heygen cost equals the estimator's per-clip rate (slice-3 spec 3.5)", () => {
    expect(ESTIMATED_COST.heygen).toBe(HEYGEN_COST_PER_CLIP);
  });
});
