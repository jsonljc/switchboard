import { describe, it, expect } from "vitest";
import { assessBudgetDrift } from "../budget-reallocation-plan.js";

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
