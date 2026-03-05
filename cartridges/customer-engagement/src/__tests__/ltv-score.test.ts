// ---------------------------------------------------------------------------
// Tests: LTV Score
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computeLTV } from "../core/scoring/ltv-score.js";

describe("computeLTV", () => {
  it("should compute a positive LTV", () => {
    const result = computeLTV({
      averageServiceValue: 500,
      visitFrequencyPerYear: 2,
      retentionYears: 3,
      referralCount: 1,
      noShowCount: 0,
      totalVisits: 5,
    });

    expect(result.estimatedLTV).toBeGreaterThan(0);
    expect(result.components.baseValue).toBeGreaterThan(0);
  });

  it("should classify tiers correctly", () => {
    const platinum = computeLTV({
      averageServiceValue: 2000,
      visitFrequencyPerYear: 4,
      retentionYears: 5,
      referralCount: 5,
      noShowCount: 0,
      totalVisits: 20,
    });
    expect(platinum.tier).toBe("platinum");

    const bronze = computeLTV({
      averageServiceValue: 100,
      visitFrequencyPerYear: 1,
      retentionYears: 1,
      referralCount: 0,
      noShowCount: 2,
      totalVisits: 1,
    });
    expect(bronze.tier).toBe("bronze");
  });

  it("should penalize no-shows", () => {
    const noNoShows = computeLTV({
      averageServiceValue: 500,
      visitFrequencyPerYear: 2,
      retentionYears: 3,
      referralCount: 0,
      noShowCount: 0,
      totalVisits: 5,
    });

    const withNoShows = computeLTV({
      averageServiceValue: 500,
      visitFrequencyPerYear: 2,
      retentionYears: 3,
      referralCount: 0,
      noShowCount: 5,
      totalVisits: 5,
    });

    expect(withNoShows.estimatedLTV).toBeLessThan(noNoShows.estimatedLTV);
  });

  it("should reward referrals", () => {
    const noReferrals = computeLTV({
      averageServiceValue: 500,
      visitFrequencyPerYear: 2,
      retentionYears: 3,
      referralCount: 0,
      noShowCount: 0,
      totalVisits: 5,
    });

    const withReferrals = computeLTV({
      averageServiceValue: 500,
      visitFrequencyPerYear: 2,
      retentionYears: 3,
      referralCount: 3,
      noShowCount: 0,
      totalVisits: 5,
    });

    expect(withReferrals.estimatedLTV).toBeGreaterThan(noReferrals.estimatedLTV);
  });

  it("should never return negative LTV", () => {
    const result = computeLTV({
      averageServiceValue: 10,
      visitFrequencyPerYear: 1,
      retentionYears: 1,
      referralCount: 0,
      noShowCount: 100,
      totalVisits: 1,
    });

    expect(result.estimatedLTV).toBeGreaterThanOrEqual(0);
  });
});
