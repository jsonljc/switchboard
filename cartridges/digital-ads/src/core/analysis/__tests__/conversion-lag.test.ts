import { describe, it, expect } from "vitest";
import {
  computePeriodMaturity,
  assessConversionLag,
  adjustForConversionLag,
  estimateConversionDeficit,
} from "../conversion-lag.js";
import type { DailyBreakdown } from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDaily(
  date: string,
  conversions: number,
  dayOfWeek = 0
): DailyBreakdown {
  return {
    date,
    dayOfWeek,
    spend: 100,
    impressions: 10000,
    clicks: 100,
    conversions,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computePeriodMaturity", () => {
  it("returns 1.0 for periods ending 4+ days ago", () => {
    const referenceDate = new Date("2024-01-15");
    const maturity = computePeriodMaturity("2024-01-10", referenceDate, 7);
    expect(maturity).toBe(1.0);
  });

  it("returns <1.0 for periods ending yesterday", () => {
    const referenceDate = new Date("2024-01-15");
    const maturity = computePeriodMaturity("2024-01-14", referenceDate, 7);
    expect(maturity).toBeLessThan(1.0);
    expect(maturity).toBeGreaterThan(0.8); // Most days are mature
  });

  it("returns lower maturity for periods ending today", () => {
    const referenceDate = new Date("2024-01-15");
    const maturityToday = computePeriodMaturity("2024-01-15", referenceDate, 7);
    const maturityYesterday = computePeriodMaturity("2024-01-14", referenceDate, 7);
    expect(maturityToday).toBeLessThan(maturityYesterday);
  });
});

describe("assessConversionLag", () => {
  it("detects significant lag when current period just ended", () => {
    const referenceDate = new Date("2024-01-15");
    const result = assessConversionLag(
      "2024-01-15",  // Current ended today (most immature)
      "2024-01-07",  // Previous ended 8 days ago (fully mature)
      referenceDate,
      7
    );

    expect(result.previousMaturity).toBe(1.0);
    expect(result.currentMaturity).toBeLessThan(1.0);
    expect(result.lagIsSignificant).toBe(true);
    expect(result.maturityGap).toBeGreaterThan(0.1);
  });

  it("reports no significant lag when both periods are mature", () => {
    const referenceDate = new Date("2024-01-15");
    const result = assessConversionLag(
      "2024-01-07",  // Current ended 8 days ago
      "2024-01-01",  // Previous ended 14 days ago
      referenceDate,
      7
    );

    expect(result.currentMaturity).toBe(1.0);
    expect(result.previousMaturity).toBe(1.0);
    expect(result.lagIsSignificant).toBe(false);
    expect(result.maturityGap).toBe(0);
  });
});

describe("adjustForConversionLag", () => {
  it("inflates conversions for recent days", () => {
    const referenceDate = new Date("2024-01-15");
    const dailyData: DailyBreakdown[] = [
      makeDaily("2024-01-15", 10), // Today — 35% mature, should inflate
      makeDaily("2024-01-14", 20), // Yesterday — 65% mature
      makeDaily("2024-01-10", 30), // 5 days ago — fully mature
    ];

    const adjusted = adjustForConversionLag(dailyData, referenceDate);

    // Today's 10 conversions at 35% maturity → ~29 estimated
    expect(adjusted[0].conversions).toBeGreaterThan(10);
    // Yesterday's 20 at 65% → ~31 estimated
    expect(adjusted[1].conversions).toBeGreaterThan(20);
    // 5 days ago should be unchanged
    expect(adjusted[2].conversions).toBe(30);
  });

  it("does not modify fully mature days", () => {
    const referenceDate = new Date("2024-01-15");
    const dailyData: DailyBreakdown[] = [
      makeDaily("2024-01-10", 50),
      makeDaily("2024-01-09", 45),
    ];

    const adjusted = adjustForConversionLag(dailyData, referenceDate);
    expect(adjusted[0].conversions).toBe(50);
    expect(adjusted[1].conversions).toBe(45);
  });
});

describe("estimateConversionDeficit", () => {
  it("estimates unreported conversions for recent days", () => {
    const referenceDate = new Date("2024-01-15");
    const dailyData: DailyBreakdown[] = [
      makeDaily("2024-01-15", 10), // 10 at 35% = ~29 total, deficit ~19
      makeDaily("2024-01-14", 20), // 20 at 65% = ~31 total, deficit ~11
    ];

    const deficit = estimateConversionDeficit(dailyData, referenceDate);
    expect(deficit).toBeGreaterThan(0);
    // 10/0.35 - 10 + 20/0.65 - 20 ≈ 18.57 + 10.77 ≈ 29
    expect(deficit).toBeGreaterThan(20);
  });

  it("returns 0 for fully mature data", () => {
    const referenceDate = new Date("2024-01-15");
    const dailyData: DailyBreakdown[] = [
      makeDaily("2024-01-10", 50),
      makeDaily("2024-01-09", 45),
    ];

    const deficit = estimateConversionDeficit(dailyData, referenceDate);
    expect(deficit).toBe(0);
  });
});
