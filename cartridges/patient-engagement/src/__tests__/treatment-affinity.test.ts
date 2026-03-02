// ---------------------------------------------------------------------------
// Tests: Treatment Affinity
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computeTreatmentAffinity } from "../core/scoring/treatment-affinity.js";

describe("computeTreatmentAffinity", () => {
  it("should return recommendations for botox", () => {
    const result = computeTreatmentAffinity({
      currentTreatment: "botox",
      ageRange: "36-45",
      budgetIndicator: 7,
      previousTreatments: [],
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]!.affinityScore).toBeGreaterThan(0);
  });

  it("should exclude previously done treatments", () => {
    const result = computeTreatmentAffinity({
      currentTreatment: "botox",
      ageRange: "36-45",
      budgetIndicator: 7,
      previousTreatments: ["filler"],
    });

    expect(result.recommendations.every((r) => r.treatment !== "filler")).toBe(true);
  });

  it("should return at most 3 recommendations", () => {
    const result = computeTreatmentAffinity({
      currentTreatment: "botox",
      ageRange: "36-45",
      budgetIndicator: 10,
      previousTreatments: [],
    });

    expect(result.recommendations.length).toBeLessThanOrEqual(3);
  });

  it("should sort by affinity score descending", () => {
    const result = computeTreatmentAffinity({
      currentTreatment: "laser",
      ageRange: "46-55",
      budgetIndicator: 5,
      previousTreatments: [],
    });

    for (let i = 1; i < result.recommendations.length; i++) {
      expect(result.recommendations[i]!.affinityScore).toBeLessThanOrEqual(
        result.recommendations[i - 1]!.affinityScore,
      );
    }
  });

  it("should apply age modifiers", () => {
    const young = computeTreatmentAffinity({
      currentTreatment: "dental_cleaning",
      ageRange: "18-25",
      budgetIndicator: 5,
      previousTreatments: [],
    });

    const older = computeTreatmentAffinity({
      currentTreatment: "dental_cleaning",
      ageRange: "56-65",
      budgetIndicator: 5,
      previousTreatments: [],
    });

    // Young should have orthodontics boosted
    const youngOrtho = young.recommendations.find((r) => r.treatment === "orthodontics");
    const olderOrtho = older.recommendations.find((r) => r.treatment === "orthodontics");
    if (youngOrtho && olderOrtho) {
      expect(youngOrtho.affinityScore).toBeGreaterThanOrEqual(olderOrtho.affinityScore);
    }
  });
});
