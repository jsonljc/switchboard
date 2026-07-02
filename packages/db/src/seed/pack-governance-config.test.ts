import { describe, it, expect } from "vitest";
import { buildObserveGovernanceConfig, buildSafeHarborFloorConfig } from "@switchboard/schemas";
import {
  selectPackGovernanceConfig,
  DEFAULT_PROVISIONING_VERTICAL,
  DEFAULT_PROVISIONING_MARKET,
} from "./pack-governance-config.js";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "./medspa-governance-config.js";

describe("selectPackGovernanceConfig: the (vertical, market) pack-selection seam", () => {
  it("defaults to medspa / SG and returns the EXISTING MEDSPA_PILOT_GOVERNANCE_CONFIG constant", () => {
    // Byte-identical guarantee for existing orgs: the default seam must return the very
    // constant the db seeder stamped before this slice, not a look-alike rebuild.
    expect(selectPackGovernanceConfig()).toBe(MEDSPA_PILOT_GOVERNANCE_CONFIG);
    expect(selectPackGovernanceConfig({})).toBe(MEDSPA_PILOT_GOVERNANCE_CONFIG);
  });

  it("returns the medspa constant for an explicit medspa / SG selection", () => {
    expect(selectPackGovernanceConfig({ vertical: "medspa", market: "SG" })).toBe(
      MEDSPA_PILOT_GOVERNANCE_CONFIG,
    );
  });

  it("the medspa / SG default is the all-gates-observe SG/medical posture", () => {
    expect(selectPackGovernanceConfig()).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
    );
    expect(selectPackGovernanceConfig().deterministicGate.mode).toBe("observe");
  });

  it("keys the OBSERVE posture on market: MY yields the MY/medical observe config, distinct from SG", () => {
    const my = selectPackGovernanceConfig({ market: "MY" });
    expect(my).toEqual(buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "medical" }));
    // Proves market is a real selection key, not ignored (a dropped param would return the SG default).
    expect(my).not.toEqual(selectPackGovernanceConfig({ market: "SG" }));
    expect(my.jurisdiction).toBe("MY");
    // Still observe (the pack default posture is never enforce).
    expect(my.deterministicGate.mode).toBe("observe");
  });

  it("exposes the medspa / SG defaults as named constants", () => {
    expect(DEFAULT_PROVISIONING_VERTICAL).toBe("medspa");
    expect(DEFAULT_PROVISIONING_MARKET).toBe("SG");
  });
});

describe("selectPackGovernanceConfig: the generic safe-harbor floor (SH-4)", () => {
  it("returns the safe-harbor floor for the generic vertical (SG): observe, nonMedical, generic marker", () => {
    const floor = selectPackGovernanceConfig({ vertical: "generic", market: "SG" });
    expect(floor).toEqual(buildSafeHarborFloorConfig({ jurisdiction: "SG" }));
    expect((floor as { vertical?: string }).vertical).toBe("generic");
    expect(floor.clinicType).toBe("nonMedical");
    expect(floor.deterministicGate.mode).toBe("observe");
  });

  it("keys the floor on market: MY yields the MY floor", () => {
    const my = selectPackGovernanceConfig({ vertical: "generic", market: "MY" });
    expect(my.jurisdiction).toBe("MY");
    expect((my as { vertical?: string }).vertical).toBe("generic");
  });

  it("does not disturb the medspa default (still the byte-identical constant)", () => {
    expect(selectPackGovernanceConfig()).toBe(MEDSPA_PILOT_GOVERNANCE_CONFIG);
    expect(selectPackGovernanceConfig({ vertical: "medspa", market: "SG" })).toBe(
      MEDSPA_PILOT_GOVERNANCE_CONFIG,
    );
  });
});
