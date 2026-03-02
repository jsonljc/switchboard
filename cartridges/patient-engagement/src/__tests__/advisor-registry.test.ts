// ---------------------------------------------------------------------------
// Tests: Advisor Registry
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveAdvisors } from "../advisors/registry.js";

describe("resolveAdvisors", () => {
  it("should return 24 advisors for any clinic type", () => {
    const advisors = resolveAdvisors("general");
    expect(advisors.length).toBe(24);
  });

  it("should return all pure functions", () => {
    const advisors = resolveAdvisors("dental");
    for (const advisor of advisors) {
      expect(typeof advisor).toBe("function");
    }
  });

  it("should return same count for all clinic types", () => {
    const types = ["dental", "dermatology", "aesthetics", "orthodontics", "general", "specialty"] as const;
    for (const type of types) {
      const advisors = resolveAdvisors(type);
      expect(advisors.length).toBe(24);
    }
  });
});
