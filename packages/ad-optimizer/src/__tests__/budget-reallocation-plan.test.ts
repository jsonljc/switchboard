import { describe, it, expect } from "vitest";
import {
  assessBudgetDrift,
  computeBudgetDelta,
  proposeCampaignReallocationCents,
  REALLOCATE_SCALE_FACTOR,
} from "../budget-reallocation-plan.js";

describe("computeBudgetDelta (Spec-1B signed delta + governance magnitude)", () => {
  it("an increase yields a positive signed delta and equal magnitude", () => {
    expect(computeBudgetDelta(5000, 8000)).toEqual({
      deltaCentsSigned: 3000,
      deltaCentsMagnitude: 3000,
    });
  });
  it("a decrease yields a negative signed delta and a positive magnitude", () => {
    expect(computeBudgetDelta(8000, 5000)).toEqual({
      deltaCentsSigned: -3000,
      deltaCentsMagnitude: 3000,
    });
  });
  it("a no-op yields zero", () => {
    expect(computeBudgetDelta(5000, 5000)).toEqual({ deltaCentsSigned: 0, deltaCentsMagnitude: 0 });
  });
  it("returns null on a non-finite current (never a NaN delta)", () => {
    expect(computeBudgetDelta(Number.NaN, 5000)).toBeNull();
  });
  it("returns null on a non-finite proposed (never a NaN delta)", () => {
    expect(computeBudgetDelta(5000, Number.NaN)).toBeNull();
  });
});

describe("assessBudgetDrift (Spec-1B fail-closed-on-drift)", () => {
  it("ok when live equals the frozen 'from'", () => {
    expect(assessBudgetDrift(5000, 5000)).toEqual({ ok: true });
  });
  it("BUDGET_DRIFTED when live differs from the frozen 'from'", () => {
    expect(assessBudgetDrift(5000, 6000)).toEqual({ ok: false, reason: "BUDGET_DRIFTED" });
  });
  it("BUDGET_DRIFTED on a non-finite frozen value (defensive NaN-guard, never sails through)", () => {
    expect(assessBudgetDrift(Number.NaN, 5000)).toEqual({ ok: false, reason: "BUDGET_DRIFTED" });
  });
  it("BUDGET_DRIFTED on a non-finite live value (defensive NaN-guard)", () => {
    expect(assessBudgetDrift(5000, Number.NaN)).toEqual({ ok: false, reason: "BUDGET_DRIFTED" });
  });
});

describe("proposeCampaignReallocationCents (Spec-1B campaign-budget scale)", () => {
  it("the default factor is a +20% scale, mirroring the recommendation engine's scale semantics", () => {
    expect(REALLOCATE_SCALE_FACTOR).toBe(1.2);
  });
  it("scales the current daily budget by the default 1.2 factor", () => {
    expect(proposeCampaignReallocationCents(5000)).toBe(6000);
  });
  it("rounds to the nearest cent (down)", () => {
    // 5001 * 1.2 = 6001.2 -> 6001
    expect(proposeCampaignReallocationCents(5001)).toBe(6001);
  });
  it("rounds to the nearest cent (up)", () => {
    // 5004 * 1.2 = 6004.8 -> 6005
    expect(proposeCampaignReallocationCents(5004)).toBe(6005);
  });
  it("honors an explicit factor", () => {
    expect(proposeCampaignReallocationCents(5000, 2)).toBe(10000);
  });
  it("returns null on a non-finite current (never a NaN proposal)", () => {
    expect(proposeCampaignReallocationCents(Number.NaN)).toBeNull();
  });
  it("returns null on a non-positive current (cannot scale a zero/negative budget)", () => {
    expect(proposeCampaignReallocationCents(0)).toBeNull();
    expect(proposeCampaignReallocationCents(-100)).toBeNull();
  });
  it("returns null on a non-finite or non-positive factor", () => {
    expect(proposeCampaignReallocationCents(5000, Number.NaN)).toBeNull();
    expect(proposeCampaignReallocationCents(5000, 0)).toBeNull();
    expect(proposeCampaignReallocationCents(5000, -1)).toBeNull();
  });
  it("returns null when the rounded result would not be a safe integer (defensive overflow guard)", () => {
    expect(proposeCampaignReallocationCents(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});
