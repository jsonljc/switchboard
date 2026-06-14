import { describe, it, expect } from "vitest";
import { evaluateEntitlement } from "@switchboard/core/billing";
import { DEFAULT_BUSINESS_HOURS } from "@switchboard/schemas";
import { LAZY_ORG_CONFIG_CREATE_DEFAULTS } from "../org-config-defaults.js";

describe("LAZY_ORG_CONFIG_CREATE_DEFAULTS (F-02)", () => {
  it("carries the F-01 business hours and the F-02 comped-pilot override", () => {
    expect(LAZY_ORG_CONFIG_CREATE_DEFAULTS.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(LAZY_ORG_CONFIG_CREATE_DEFAULTS.entitlementOverride).toBe(true);
  });

  it("makes a fresh org (default 'none' status) entitled via the override", () => {
    // Seam from the producer-of-record: the defaults source evaluates to entitled.
    expect(
      evaluateEntitlement({
        subscriptionStatus: "none",
        entitlementOverride: LAZY_ORG_CONFIG_CREATE_DEFAULTS.entitlementOverride,
      }),
    ).toEqual({ entitled: true, reason: "override" });
  });
});
