import { describe, it, expect } from "vitest";
import { GOLDEN_SET } from "../golden-set.js";

describe("golden set", () => {
  it("has ≥40 entries", () => {
    expect(GOLDEN_SET.length).toBeGreaterThanOrEqual(40);
  });

  it("covers all 9 claim types", () => {
    const seen = new Set(GOLDEN_SET.map((g) => g.expectedClaimType));
    for (const ct of [
      "efficacy",
      "safety-claim",
      "superiority",
      "urgency",
      "testimonial",
      "medical-advice",
      "diagnosis",
      "credentials",
      "none",
    ] as const) {
      expect(seen.has(ct), `golden set missing ${ct}`).toBe(true);
    }
  });

  it("has entries for both jurisdictions", () => {
    const jurisdictions = new Set(GOLDEN_SET.map((g) => g.jurisdiction));
    expect(jurisdictions.has("SG")).toBe(true);
    expect(jurisdictions.has("MY")).toBe(true);
  });
});
