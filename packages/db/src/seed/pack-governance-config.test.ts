import { describe, it, expect } from "vitest";
import {
  buildObserveGovernanceConfig,
  buildSafeHarborFloorConfig,
  resolveMarket,
} from "@switchboard/schemas";
import { selectPackGovernanceConfig } from "./pack-governance-config.js";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "./medspa-governance-config.js";

describe("selectPackGovernanceConfig: medspa stays byte-identical (vetted profile, never markers)", () => {
  it("medspa / SG returns the EXISTING MEDSPA_PILOT_GOVERNANCE_CONFIG constant (by reference)", () => {
    // Byte-identical guarantee for existing orgs: the vetted-profile SG path must return
    // the very db constant the seeders stamped before this seam, not a look-alike rebuild.
    expect(selectPackGovernanceConfig({ regulatoryProfileId: "medspa", market: "SG" })).toBe(
      MEDSPA_PILOT_GOVERNANCE_CONFIG,
    );
  });

  it("defaults (no input) resolve to the medspa / SG constant (by reference)", () => {
    expect(selectPackGovernanceConfig()).toBe(MEDSPA_PILOT_GOVERNANCE_CONFIG);
    expect(selectPackGovernanceConfig({})).toBe(MEDSPA_PILOT_GOVERNANCE_CONFIG);
  });

  it("medspa / MY is the marker-free MY/medical observe posture (exact SH-4 output preserved)", () => {
    const my = selectPackGovernanceConfig({ regulatoryProfileId: "medspa", market: "MY" });
    expect(my).toEqual(buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "medical" }));
    // The vetted-profile path NEVER stamps the passthrough markers (they would drift the
    // byte-identical output). A dropped market param would return the SG default, so this
    // also proves market is a real selection key.
    expect("market" in my).toBe(false);
    expect("regulatoryProfileId" in my).toBe(false);
    expect(my.jurisdiction).toBe("MY");
    expect(my.deterministicGate.mode).toBe("observe");
  });
});

describe("selectPackGovernanceConfig: generic / self-serve stamps market + profile markers", () => {
  it("generic / SG is the safe-harbor floor plus the market + regulatoryProfileId markers", () => {
    const expected = {
      ...buildSafeHarborFloorConfig({ jurisdiction: "SG" }),
      market: "SG",
      regulatoryProfileId: "generic",
    };
    expect(selectPackGovernanceConfig({ regulatoryProfileId: "generic", market: "SG" })).toEqual(
      expected,
    );
  });

  it("an unknown profile fails closed to generic (the RESOLVED id is stamped) and never throws", () => {
    const expected = {
      ...buildSafeHarborFloorConfig({ jurisdiction: "SG" }),
      market: "SG",
      regulatoryProfileId: "generic",
    };
    expect(() =>
      selectPackGovernanceConfig({ regulatoryProfileId: "salon", market: "SG" }),
    ).not.toThrow();
    const result = selectPackGovernanceConfig({ regulatoryProfileId: "salon", market: "SG" });
    expect(result).toEqual(expected);
    // The stamped id is the resolved "generic", not the unknown "salon" request.
    expect((result as { regulatoryProfileId?: string }).regulatoryProfileId).toBe("generic");
  });

  it("an unknown market fails closed: loader jurisdiction SG, real market preserved, resolveMarket null", () => {
    expect(() =>
      selectPackGovernanceConfig({ regulatoryProfileId: "generic", market: "TH" }),
    ).not.toThrow();
    const result = selectPackGovernanceConfig({ regulatoryProfileId: "generic", market: "TH" });
    // The stored `jurisdiction` only holds the SG/MY loader jurisdiction, so it falls back to SG...
    expect(result.jurisdiction).toBe("SG");
    // ...but the real requested market rides as a passthrough marker so it is not silently lost...
    expect((result as { market?: string }).market).toBe("TH");
    // ...and because TH is unregistered, resolveMarket is null → currency/PDPA fail closed downstream.
    expect(resolveMarket(result)).toBeNull();
  });
});
