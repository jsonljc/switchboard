// ---------------------------------------------------------------------------
// Tests: Treatment Affinity
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computeServiceAffinity } from "../core/scoring/service-affinity.js";

describe("computeServiceAffinity", () => {
  it("should return recommendations for botox", () => {
    const result = computeServiceAffinity({
      currentService: "botox",
      ageRange: "36-45",
      budgetIndicator: 7,
      previousServices: [],
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]!.affinityScore).toBeGreaterThan(0);
  });

  it("should exclude previously done treatments", () => {
    const result = computeServiceAffinity({
      currentService: "botox",
      ageRange: "36-45",
      budgetIndicator: 7,
      previousServices: ["filler"],
    });

    expect(result.recommendations.every((r) => r.treatment !== "filler")).toBe(true);
  });

  it("should return at most 3 recommendations", () => {
    const result = computeServiceAffinity({
      currentService: "botox",
      ageRange: "36-45",
      budgetIndicator: 10,
      previousServices: [],
    });

    expect(result.recommendations.length).toBeLessThanOrEqual(3);
  });

  it("should sort by affinity score descending", () => {
    const result = computeServiceAffinity({
      currentService: "laser",
      ageRange: "46-55",
      budgetIndicator: 5,
      previousServices: [],
    });

    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i]!.affinityScore).toBeLessThanOrEqual(
        result.recommendations[i - 1]!.affinityScore,
      );
    }
  });

  it("should apply age modifiers", () => {
    const young = computeServiceAffinity({
      currentService: "dental_cleaning",
      ageRange: "18-25",
      budgetIndicator: 5,
      previousServices: [],
    });

    const older = computeServiceAffinity({
      currentService: "dental_cleaning",
      ageRange: "56-65",
      budgetIndicator: 5,
      previousServices: [],
    });

    // Young should have orthodontics boosted
    const youngOrtho = young.recommendations.find((r) => r.treatment === "orthodontics");
    const olderOrtho = older.recommendations.find((r) => r.treatment === "orthodontics");
    if (youngOrtho && olderOrtho) {
      expect(youngOrtho.affinityScore).toBeGreaterThanOrEqual(olderOrtho.affinityScore);
    }
  });
});
