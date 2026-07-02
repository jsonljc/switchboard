import { describe, it, expect } from "vitest";
import { resolveRegulatoryProfile } from "./regulatory-profile-registry.js";
import { buildObserveGovernanceConfig, buildSafeHarborFloorConfig } from "./governance-config.js";

describe("resolveRegulatoryProfile", () => {
  it("resolves the medspa profile", () => {
    const profile = resolveRegulatoryProfile("medspa");
    expect(profile.loaderVertical).toBe("medspa");
    expect(profile.clinicType).toBe("medical");
  });

  it("resolves the generic profile", () => {
    const profile = resolveRegulatoryProfile("generic");
    expect(profile.loaderVertical).toBe("generic");
    expect(profile.clinicType).toBe("nonMedical");
  });

  it("falls back to the generic profile for an unregistered id", () => {
    expect(resolveRegulatoryProfile("fitness").id).toBe("generic");
    expect(resolveRegulatoryProfile("").id).toBe("generic");
    expect(resolveRegulatoryProfile("wellness-clinic").id).toBe("generic");
  });

  it("the generic profile's observe posture matches buildSafeHarborFloorConfig (value-equal)", () => {
    expect(resolveRegulatoryProfile("generic").buildObservePosture("SG")).toEqual(
      buildSafeHarborFloorConfig({ jurisdiction: "SG" }),
    );
    expect(resolveRegulatoryProfile("generic").buildObservePosture("MY")).toEqual(
      buildSafeHarborFloorConfig({ jurisdiction: "MY" }),
    );
  });

  it("the medspa profile's observe posture matches buildObserveGovernanceConfig (value-equal, not by-reference)", () => {
    expect(resolveRegulatoryProfile("medspa").buildObservePosture("SG")).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" }),
    );
    expect(resolveRegulatoryProfile("medspa").buildObservePosture("MY")).toEqual(
      buildObserveGovernanceConfig({ jurisdiction: "MY", clinicType: "medical" }),
    );
  });

  it("falls back to the SG loader jurisdiction for an unknown market (no throw)", () => {
    expect(() => resolveRegulatoryProfile("generic").buildObservePosture("TH")).not.toThrow();
    expect(resolveRegulatoryProfile("generic").buildObservePosture("TH")).toEqual(
      buildSafeHarborFloorConfig({ jurisdiction: "SG" }),
    );
  });
});

describe("prototype-chain fail-closed", () => {
  it("falls back to generic for inherited Object.prototype keys, not the inherited value", () => {
    expect(resolveRegulatoryProfile("constructor").id).toBe("generic");
    expect(resolveRegulatoryProfile("__proto__").id).toBe("generic");
    expect(resolveRegulatoryProfile("toString").id).toBe("generic");
  });
});
