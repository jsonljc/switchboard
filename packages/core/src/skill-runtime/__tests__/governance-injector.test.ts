import { describe, it, expect } from "vitest";
import { getGovernanceConstraints, getSafetyRecencyReminder } from "../governance-injector.js";

describe("getGovernanceConstraints", () => {
  it("returns the mandatory-rules block", () => {
    const c = getGovernanceConstraints();
    expect(c).toContain("MANDATORY RULES");
    expect(c).toContain("Never claim to be human");
  });
});

describe("getSafetyRecencyReminder", () => {
  it("re-states the hardest safety rules in a short reminder", () => {
    const r = getSafetyRecencyReminder().toLowerCase();
    expect(r).toContain("human");
    expect(r).toContain("opt-out");
    expect(r).toContain("financial");
  });

  it("is SHORTER than the full constraints and omits the structural tool-output section", () => {
    const r = getSafetyRecencyReminder();
    expect(r.length).toBeLessThan(getGovernanceConstraints().length);
    expect(r).not.toContain("TOOL OUTPUT HANDLING");
  });

  it("contains no em-dash (house style)", () => {
    expect(getSafetyRecencyReminder()).not.toContain("—");
  });
});
