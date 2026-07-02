import { describe, it, expect } from "vitest";
import { currencyForMarket, resolveMarket } from "./market-registry.js";
import { currencyForJurisdiction, JURISDICTIONS } from "./governance-config.js";

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
