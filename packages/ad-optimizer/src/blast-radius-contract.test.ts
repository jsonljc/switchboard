import { describe, it, expect } from "vitest";
import {
  assertWithinBlastRadius,
  BLAST_RADIUS_PROTECTIONS,
  DEFAULT_BLAST_RADIUS_CONTRACT,
  type BlastRadiusContract,
  type BlastRadiusGuardrailMetric,
} from "./blast-radius-contract.js";

// Canonical reallocate-class contract (the shape Spec-1B's reallocation intent
// carries): a $50 absolute ceiling, a 0.25 account-spend-share ceiling, one
// machine-comparable guardrail the forward outcome-attribution cron evaluates,
// and the automated reset_prior_budget rollback. Cents end-to-end.
const contract: BlastRadiusContract = {
  maxDeltaCents: 50_00, // $50
  maxAccountSpendShare: 0.25,
  guardrails: [{ metric: "freed_budget_absorbed_share", breachAbove: 0.5, windowHours: 72 }],
  rollback: { kind: "reset_prior_budget", capturePriorValue: true },
};

describe("assertWithinBlastRadius — cap enforcement", () => {
  it("allows a delta within both caps", () => {
    expect(assertWithinBlastRadius(contract, 30_00, 1000_00)).toEqual({ ok: true });
  });

  it("refuses a delta over the dollar cap", () => {
    expect(assertWithinBlastRadius(contract, 80_00, 1000_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });

  it("refuses a small-dollar delta that is a large account share", () => {
    // $30 on a $40/day account = 0.75 share > 0.25
    expect(assertWithinBlastRadius(contract, 30_00, 40_00)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });

  it("treats the dollar cap as the first breach when both caps are exceeded", () => {
    // $80 (> $50 cap) AND 0.8 share (> 0.25) on a $100/day account: dollar wins.
    expect(assertWithinBlastRadius(contract, 80_00, 100_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });
});

describe("assertWithinBlastRadius — fail closed on non-finite delta", () => {
  it("refuses a NaN delta", () => {
    expect(assertWithinBlastRadius(contract, Number.NaN, 1000_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });

  it("refuses an infinite delta", () => {
    expect(assertWithinBlastRadius(contract, Number.POSITIVE_INFINITY, 1000_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });
});

describe("assertWithinBlastRadius — fail closed when the account cannot be sized", () => {
  // The share cap guards the "small account, large relative move" case. A
  // non-finite or non-positive denominator means the move cannot be sized, so a
  // money move must REFUSE rather than skip the share cap (feedback_nan_blind_
  // comparison_gates: NaN > 0 is false, so a skip-on-`> 0` guard is a fail-open).
  it("refuses a NaN account daily spend", () => {
    expect(assertWithinBlastRadius(contract, 30_00, Number.NaN)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });

  it("refuses a zero account daily spend", () => {
    expect(assertWithinBlastRadius(contract, 30_00, 0)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });

  it("refuses a negative account daily spend", () => {
    expect(assertWithinBlastRadius(contract, 30_00, -100_00)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });
});

describe("assertWithinBlastRadius — fail closed on a malformed contract cap", () => {
  it("refuses when the dollar cap is non-finite", () => {
    const noDollarCap: BlastRadiusContract = { ...contract, maxDeltaCents: Number.NaN };
    expect(assertWithinBlastRadius(noDollarCap, 30_00, 1000_00)).toEqual({
      ok: false,
      reason: "DELTA_CAP",
    });
  });

  it("refuses when the share cap is non-finite", () => {
    const noShareCap: BlastRadiusContract = { ...contract, maxAccountSpendShare: Number.NaN };
    expect(assertWithinBlastRadius(noShareCap, 10_00, 40_00)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });
});

describe("assertWithinBlastRadius — inclusive cap boundaries", () => {
  it("allows a delta exactly at the dollar cap", () => {
    // |5000| == maxDeltaCents 5000: at the cap is allowed, only over refuses.
    expect(assertWithinBlastRadius(contract, 50_00, 1000_00)).toEqual({ ok: true });
  });

  it("allows a delta exactly at the share cap", () => {
    // $10 on a $40/day account = exactly 0.25 == maxAccountSpendShare.
    expect(assertWithinBlastRadius(contract, 10_00, 40_00)).toEqual({ ok: true });
  });

  it("allows a zero delta (no blast radius)", () => {
    expect(assertWithinBlastRadius(contract, 0, 1000_00)).toEqual({ ok: true });
  });
});

describe("BlastRadiusContract — forward interface shape", () => {
  it("carries machine-comparable numeric caps, a typed guardrail, and an automated rollback", () => {
    // Pins the forward interface Spec-1B's reallocate intent + outcome-attribution
    // cron consume: a field rename or a regression to prose breaks this.
    expect(Number.isFinite(contract.maxDeltaCents)).toBe(true);
    expect(Number.isFinite(contract.maxAccountSpendShare)).toBe(true);
    expect(contract.guardrails).toHaveLength(1);
    const guardrail = contract.guardrails[0]!;
    expect(guardrail.metric).toBe("freed_budget_absorbed_share");
    expect(Number.isFinite(guardrail.breachAbove)).toBe(true);
    expect(Number.isFinite(guardrail.windowHours)).toBe(true);
    expect(contract.rollback.kind).toBe("reset_prior_budget");
    expect(contract.rollback.capturePriorValue).toBe(true);
  });

  it("keeps the guardrail metric union closed (no string widening)", () => {
    // Compile-time pin: an arbitrary string is NOT a valid metric. If this stops
    // erroring under tsc, the union widened to `string` and lost its typo-safety
    // (the exact regression the BlastRadiusGuardrailMetric doc warns against).
    // @ts-expect-error not_a_real_metric is outside the closed metric union.
    const widened: BlastRadiusGuardrailMetric = "not_a_real_metric";
    expect(widened).toBe("not_a_real_metric");
  });
});

describe("DEFAULT_BLAST_RADIUS_CONTRACT — the v1 default the reallocate executor enforces", () => {
  it("is a well-formed, conservative contract (finite positive caps, share in (0,1], capture-prior rollback)", () => {
    const c = DEFAULT_BLAST_RADIUS_CONTRACT;
    expect(Number.isFinite(c.maxDeltaCents)).toBe(true);
    expect(c.maxDeltaCents).toBeGreaterThan(0);
    expect(c.maxAccountSpendShare).toBeGreaterThan(0);
    expect(c.maxAccountSpendShare).toBeLessThanOrEqual(1);
    expect(c.guardrails.length).toBeGreaterThan(0);
    expect(c.rollback).toEqual({ kind: "reset_prior_budget", capturePriorValue: true });
  });

  it("admits a typical small +20% scale and refuses an oversized move (composes with the cap)", () => {
    // A $200/day campaign scaled +20% = +$40 delta on a $1000/day account: within both caps.
    expect(assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, 40_00, 1000_00)).toEqual({
      ok: true,
    });
    // A $900 delta blows the dollar cap.
    expect(assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, 900_00, 100000_00).ok).toBe(
      false,
    );
    // A small delta that is a huge share of a tiny account is refused.
    expect(assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, 30_00, 40_00)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });
});

describe("BLAST_RADIUS_PROTECTIONS — honest wiring state (A6/D3)", () => {
  it("marks the pre-write cap WIRED and the forward guardrails + rollback DECISION-wired", () => {
    // The decision logic (evaluateBlastRadiusGuardrails / planReallocationRollback /
    // runReallocationGuardrailMonitor) is now built + fail-closed + unit-pinned; the real-dep
    // monitor pass (Meta-window measurement + governed reset_prior_budget dispatch) remains.
    expect(BLAST_RADIUS_PROTECTIONS.preWriteCap).toBe("wired");
    expect(BLAST_RADIUS_PROTECTIONS.forwardGuardrails).toBe("decision_wired");
    expect(BLAST_RADIUS_PROTECTIONS.automatedRollback).toBe("decision_wired");
  });
});
