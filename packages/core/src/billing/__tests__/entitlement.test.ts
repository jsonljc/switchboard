import { describe, it, expect } from "vitest";
import { evaluateEntitlement } from "../entitlement.js";

describe("evaluateEntitlement", () => {
  it("active subscription is entitled with reason=active", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "active", entitlementOverride: false }),
    ).toEqual({ entitled: true, reason: "active" });
  });

  it("trialing subscription is entitled with reason=trialing", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "trialing", entitlementOverride: false }),
    ).toEqual({ entitled: true, reason: "trialing" });
  });

  it("entitlementOverride wins regardless of status", () => {
    for (const status of ["none", "canceled", "past_due", "incomplete", "unpaid", "active"]) {
      expect(
        evaluateEntitlement({ subscriptionStatus: status, entitlementOverride: true }),
      ).toEqual({ entitled: true, reason: "override" });
    }
  });

  it("canceled is blocked", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "canceled", entitlementOverride: false }),
    ).toEqual({ entitled: false, reason: "blocked", blockedStatus: "canceled" });
  });

  it("past_due is blocked", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "past_due", entitlementOverride: false }),
    ).toEqual({ entitled: false, reason: "blocked", blockedStatus: "past_due" });
  });

  it("incomplete is blocked (no grace)", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "incomplete", entitlementOverride: false }),
    ).toEqual({ entitled: false, reason: "blocked", blockedStatus: "incomplete" });
  });

  it("none is blocked", () => {
    expect(evaluateEntitlement({ subscriptionStatus: "none", entitlementOverride: false })).toEqual(
      { entitled: false, reason: "blocked", blockedStatus: "none" },
    );
  });

  it("unpaid is blocked", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "unpaid", entitlementOverride: false }),
    ).toEqual({ entitled: false, reason: "blocked", blockedStatus: "unpaid" });
  });

  it("unknown status is blocked", () => {
    expect(
      evaluateEntitlement({ subscriptionStatus: "weird_state", entitlementOverride: false }),
    ).toEqual({ entitled: false, reason: "blocked", blockedStatus: "weird_state" });
  });
});
