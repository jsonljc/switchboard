// ---------------------------------------------------------------------------
// Tests: Lead Score
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computeLeadScore } from "../core/scoring/lead-score.js";
import type { LeadScoreInput } from "../core/types.js";

const baseInput: LeadScoreInput = {
  treatmentValue: 300,
  urgencyLevel: 5,
  hasInsurance: true,
  isReturning: false,
  source: "organic",
  engagementScore: 5,
  responseSpeedMs: null,
  hasMedicalHistory: false,
  budgetIndicator: 5,
  eventDriven: false,
};

describe("computeLeadScore", () => {
  it("should return a score between 0 and 100", () => {
    const result = computeLeadScore(baseInput);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("should classify tiers correctly", () => {
    const hot = computeLeadScore({
      ...baseInput,
      treatmentValue: 1000,
      urgencyLevel: 10,
      eventDriven: true,
      source: "referral",
      engagementScore: 10,
      responseSpeedMs: 120000, // 2 min
      budgetIndicator: 10,
      isReturning: true,
    });
    expect(hot.tier).toBe("hot");

    const cold = computeLeadScore({
      ...baseInput,
      treatmentValue: 0,
      urgencyLevel: 0,
      source: "other",
      engagementScore: 0,
      budgetIndicator: 0,
      hasMedicalHistory: true,
    });
    expect(cold.tier).toBe("cold");
  });

  it("should penalize medical history", () => {
    const withoutHistory = computeLeadScore({ ...baseInput, hasMedicalHistory: false });
    const withHistory = computeLeadScore({ ...baseInput, hasMedicalHistory: true });
    expect(withHistory.score).toBeLessThan(withoutHistory.score);
  });

  it("should reward fast response speed", () => {
    const fast = computeLeadScore({ ...baseInput, responseSpeedMs: 60000 }); // 1 min
    const slow = computeLeadScore({ ...baseInput, responseSpeedMs: 7200000 }); // 2 hrs
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it("should reward referral source", () => {
    const referral = computeLeadScore({ ...baseInput, source: "referral" });
    const paid = computeLeadScore({ ...baseInput, source: "paid" });
    expect(referral.score).toBeGreaterThan(paid.score);
  });

  it("should include factor breakdown", () => {
    const result = computeLeadScore(baseInput);
    expect(result.factors.length).toBeGreaterThan(0);
    expect(result.factors.some((f) => f.factor === "treatment_value")).toBe(true);
  });
});
