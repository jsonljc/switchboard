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

  // D1-1/measurement-trust: an account-wide CAPI/pixel outage zeros conversions
  // across BOTH windows while real, flat traffic continues. The prior code early-
  // returned "trusted" on previous.conversions<=0, so Riley would pause/scale on a
  // broken signal. This must demote instead (suspected => measurement_untrusted).
  it("flags sustained zero conversions across both windows despite real flat clicks (CAPI outage)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 400, conversions: 0, spend: 1200 },
      previous: { clicks: 420, conversions: 0, spend: 1250 },
    });
    expect(r.suspected).toBe(true);
  });

  it("does NOT flag both-zero windows when traffic is too thin to judge (insufficient evidence)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 30, conversions: 0, spend: 80 },
      previous: { clicks: 28, conversions: 0, spend: 75 },
    });
    expect(r.suspected).toBe(false);
  });

  it("does NOT flag when a previously-zero account STARTS converting (recovery, not a collapse)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 400, conversions: 8, spend: 1200 },
      previous: { clicks: 400, conversions: 0, spend: 1200 },
    });
    expect(r.suspected).toBe(false);
  });

  it("does NOT flag a both-zero window when current traffic has dried up (no live signal to judge)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 5, conversions: 0, spend: 20 },
      previous: { clicks: 400, conversions: 0, spend: 1200 },
    });
    expect(r.suspected).toBe(false);
  });

  it("does NOT flag on a NaN current-conversions (fail-closed: missing evidence is not a burn outage)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 400, conversions: NaN, spend: 1200 },
      previous: { clicks: 400, conversions: 0, spend: 1200 },
    });
    expect(r.suspected).toBe(false);
  });
});

describe("detectDenominatorStepChange signature", () => {
  it("tags the zero-conversions-despite-traffic outage as zero_despite_traffic", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 60, conversions: 0, spend: 500 },
      previous: { clicks: 60, conversions: 0, spend: 500 },
    });
    expect(result.suspected).toBe(true);
    expect(result.signature).toBe("zero_despite_traffic");
  });

  it("tags a rate collapse with flat clicks as rate_collapse (not the CAPI outage)", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 5, spend: 500 },
      previous: { clicks: 1000, conversions: 50, spend: 500 },
    });
    expect(result.suspected).toBe(true);
    expect(result.signature).toBe("rate_collapse");
  });

  it("leaves signature undefined when nothing is suspected", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 50, spend: 500 },
      previous: { clicks: 1000, conversions: 50, spend: 500 },
    });
    expect(result.suspected).toBe(false);
    expect(result.signature).toBeUndefined();
  });

  it("abstains (no signature) when zero conversions but traffic is below the floor", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 10, conversions: 0, spend: 500 },
      previous: { clicks: 10, conversions: 0, spend: 500 },
    });
    expect(result.suspected).toBe(false);
    expect(result.signature).toBeUndefined();
  });
});
