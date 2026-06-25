import { describe, it, expect } from "vitest";
import { evaluateGateEnforceReadiness } from "./evaluate-gate-enforce-readiness.js";

const present = { approvedPriceCount: 3, approvedClaimCount: 2, approvedTemplateCount: 1 };
const absent = { approvedPriceCount: 0, approvedClaimCount: 0, approvedTemplateCount: 0 };

describe("evaluateGateEnforceReadiness", () => {
  it("deterministic: ready iff >=1 approved price", () => {
    expect(evaluateGateEnforceReadiness("deterministic", present).ready).toBe(true);
    const r = evaluateGateEnforceReadiness("deterministic", absent);
    expect(r.ready).toBe(false);
    expect(r.blockingReason).toMatch(/approved (service )?price/i);
  });

  it("claims: ready iff >=1 approved compliance claim", () => {
    expect(evaluateGateEnforceReadiness("claims", present).ready).toBe(true);
    const r = evaluateGateEnforceReadiness("claims", absent);
    expect(r.ready).toBe(false);
    expect(r.blockingReason).toMatch(/approved (compliance )?claim/i);
  });

  it("whatsapp: ready iff >=1 approved template", () => {
    expect(evaluateGateEnforceReadiness("whatsapp", present).ready).toBe(true);
    const r = evaluateGateEnforceReadiness("whatsapp", absent);
    expect(r.ready).toBe(false);
    expect(r.blockingReason).toMatch(/template/i);
  });

  it("consent: ALWAYS ready (fail-safe by construction, no producer gate)", () => {
    expect(evaluateGateEnforceReadiness("consent", absent)).toEqual({
      ready: true,
      blockingReason: null,
    });
    expect(evaluateGateEnforceReadiness("consent", present).ready).toBe(true);
  });

  it("only the gate's OWN producer gates it (cross-producer independence)", () => {
    // deterministic ignores claim/template counts; only price matters.
    expect(
      evaluateGateEnforceReadiness("deterministic", {
        approvedPriceCount: 1,
        approvedClaimCount: 0,
        approvedTemplateCount: 0,
      }).ready,
    ).toBe(true);
    // claims ignores price/template counts; only claim count matters.
    expect(
      evaluateGateEnforceReadiness("claims", {
        approvedPriceCount: 9,
        approvedClaimCount: 0,
        approvedTemplateCount: 9,
      }).ready,
    ).toBe(false);
  });
});
