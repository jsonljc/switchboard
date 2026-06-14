import { describe, it, expect } from "vitest";
import { assessBudgetDrift, computeBudgetDelta } from "../budget-reallocation-plan.js";

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
