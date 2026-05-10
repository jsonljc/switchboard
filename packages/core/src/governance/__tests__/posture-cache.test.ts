import { describe, it, expect } from "vitest";
import { InMemoryGovernancePostureCache, type GovernancePosture } from "../posture-cache.js";

const SG_ENFORCE: GovernancePosture = {
  mode: "enforce",
  jurisdiction: "SG",
  clinicType: "medical",
};
const MY_OBSERVE: GovernancePosture = {
  mode: "observe",
  jurisdiction: "MY",
  clinicType: "nonMedical",
};
const MY_ENFORCE: GovernancePosture = {
  mode: "enforce",
  jurisdiction: "MY",
  clinicType: "nonMedical",
};

describe("InMemoryGovernancePostureCache", () => {
  it("returns undefined for an unknown deploymentId", () => {
    const cache = new InMemoryGovernancePostureCache();
    expect(cache.lastKnown("dep-1")).toBeUndefined();
  });

  it("round-trips the full posture (not just the mode)", () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-1", MY_ENFORCE);
    expect(cache.lastKnown("dep-1")).toEqual(MY_ENFORCE);
  });

  it("returns the most recent remembered posture", () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-1", MY_OBSERVE);
    cache.remember("dep-1", MY_ENFORCE);
    expect(cache.lastKnown("dep-1")).toEqual(MY_ENFORCE);
  });

  it("isolates deployments from each other", () => {
    const cache = new InMemoryGovernancePostureCache();
    cache.remember("dep-a", SG_ENFORCE);
    cache.remember("dep-b", MY_OBSERVE);
    expect(cache.lastKnown("dep-a")).toEqual(SG_ENFORCE);
    expect(cache.lastKnown("dep-b")).toEqual(MY_OBSERVE);
  });
});
