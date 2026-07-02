import { describe, it, expect } from "vitest";
import { currencyForMarket, resolveMarket } from "./market-registry.js";
import { currencyForJurisdiction, JURISDICTIONS } from "./governance-config.js";
import type { GovernanceConfig } from "./governance-config.js";

describe("currencyForMarket", () => {
  it("maps SG to SGD", () => {
    expect(currencyForMarket("SG")).toBe("SGD");
  });

  it("maps MY to MYR", () => {
    expect(currencyForMarket("MY")).toBe("MYR");
  });

  it("returns null for an unregistered market", () => {
    expect(currencyForMarket("TH")).toBeNull();
  });

  it("returns null for an empty id", () => {
    expect(currencyForMarket("")).toBeNull();
  });

  it("is case-sensitive (exact key, no normalization)", () => {
    expect(currencyForMarket("sg")).toBeNull();
  });
});

describe("resolveMarket", () => {
  it("deep-equals the full SG market record", () => {
    expect(resolveMarket("SG")).toEqual({
      id: "SG",
      currency: "SGD",
      pdpaJurisdiction: "SG",
      loaderJurisdiction: "SG",
      timezone: "Asia/Singapore",
    });
  });

  it("resolves MY's pdpaJurisdiction to MY", () => {
    expect(resolveMarket("MY")?.pdpaJurisdiction).toBe("MY");
  });

  it("returns null for an unregistered market", () => {
    expect(resolveMarket("TH")).toBeNull();
  });
});

describe("parity with the legacy currency chokepoint", () => {
  it("agrees with currencyForJurisdiction for every seeded jurisdiction (byte-identical guard)", () => {
    for (const j of JURISDICTIONS) {
      expect(currencyForMarket(j)).toBe(currencyForJurisdiction(j));
    }
  });
});

describe("prototype-chain fail-closed", () => {
  it("resolveMarket returns null for inherited Object.prototype keys, not the inherited value", () => {
    expect(resolveMarket("constructor")).toBeNull();
    expect(resolveMarket("__proto__")).toBeNull();
    expect(resolveMarket("toString")).toBeNull();
  });

  it("currencyForMarket returns null for an inherited Object.prototype key", () => {
    expect(currencyForMarket("constructor")).toBeNull();
  });
});

describe("resolveMarket (config-form)", () => {
  it("falls back to the legacy jurisdiction field when no market marker is present", () => {
    expect(
      resolveMarket({ jurisdiction: "SG", clinicType: "medical" } as GovernanceConfig)?.id,
    ).toBe("SG");
  });

  it("honors the market marker over jurisdiction when present", () => {
    expect(
      resolveMarket({
        jurisdiction: "SG",
        clinicType: "medical",
        market: "MY",
      } as unknown as GovernanceConfig)?.id,
    ).toBe("MY");
  });

  it("fails closed to null for an unregistered market marker", () => {
    expect(
      resolveMarket({
        jurisdiction: "SG",
        clinicType: "medical",
        market: "TH",
      } as unknown as GovernanceConfig),
    ).toBeNull();
  });

  it("resolves currency via the legacy jurisdiction fallback", () => {
    expect(
      resolveMarket({ jurisdiction: "MY", clinicType: "nonMedical" } as GovernanceConfig)?.currency,
    ).toBe("MYR");
  });

  it("returns null for a null config", () => {
    expect(resolveMarket(null)).toBeNull();
  });

  it("still resolves the id-form (regression guard)", () => {
    expect(resolveMarket("SG")?.id).toBe("SG");
  });
});
