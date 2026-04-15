import { describe, it, expect } from "vitest";
import { getGovernanceConstraints } from "./governance-injector.js";

describe("getGovernanceConstraints", () => {
  it("returns a non-empty string", () => {
    const constraints = getGovernanceConstraints();
    expect(constraints.length).toBeGreaterThan(100);
  });

  it("includes AI disclosure rule", () => {
    expect(getGovernanceConstraints()).toContain("Never claim to be human");
  });

  it("includes opt-out rule", () => {
    expect(getGovernanceConstraints()).toContain("Respect opt-out immediately");
  });

  it("includes no-fabrication rule", () => {
    expect(getGovernanceConstraints()).toContain("Never fabricate");
  });

  it("includes escalation rule", () => {
    expect(getGovernanceConstraints()).toContain("Always offer human escalation");
  });
});
