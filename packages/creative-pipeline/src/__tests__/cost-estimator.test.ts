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

  it("returns a zero estimate for zero specs", () => {
    const est = estimateUgcCost([]);
    expect(est.cost).toBe(0);
    expect(est.description).toBe("No clips to produce");
  });
});

describe("cost-table parity (governance signal vs production budget accumulator)", () => {
  it("the router's kling ranking cost equals the estimator's per-clip base rate", () => {
    expect(ESTIMATED_COST.kling).toBe(KLING_COST_PER_5S);
  });
});
