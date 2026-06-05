import { describe, it, expect } from "vitest";
import { detectDenominatorStepChange } from "./denominator-step-change.js";

describe("conversion-denominator step-change guard", () => {
  it("flags an account-wide conversion-rate collapse with flat spend/clicks", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 12, spend: 1000 },
      previous: { clicks: 1000, conversions: 60, spend: 1000 },
    });
    expect(r.suspected).toBe(true);
  });
  it("does not flag a normal small movement", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 55, spend: 1000 },
      previous: { clicks: 1000, conversions: 60, spend: 1000 },
    });
    expect(r.suspected).toBe(false);
  });
  it("does not flag when clicks also fell (real volume drop, not a denominator shift)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 200, conversions: 12, spend: 200 },
      previous: { clicks: 1000, conversions: 60, spend: 1000 },
    });
    expect(r.suspected).toBe(false);
  });
  it("does not flag without a prior baseline", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 12, spend: 1000 },
      previous: { clicks: 0, conversions: 0, spend: 0 },
    });
    expect(r.suspected).toBe(false);
  });
});
