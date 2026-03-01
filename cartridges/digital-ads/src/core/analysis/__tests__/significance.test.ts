import { describe, it, expect } from "vitest";
import { isSignificantChange, zScore, percentChange } from "../significance.js";

// ---------------------------------------------------------------------------
// percentChange
// ---------------------------------------------------------------------------

describe("percentChange", () => {
  it("computes basic percentage change", () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
  });

  it("returns 0 when both values are 0", () => {
    expect(percentChange(0, 0)).toBe(0);
  });

  it("returns 100 when previous is 0 and current is positive", () => {
    expect(percentChange(50, 0)).toBe(100);
  });

  it("returns -100 when previous is 0 and current is negative", () => {
    expect(percentChange(-5, 0)).toBe(-100);
  });

  it("handles negative values correctly", () => {
    // From -10 to -5: ((-5) - (-10)) / (-10) * 100 = -50
    // The magnitude decreased, but relative to negative baseline it's -50%
    expect(percentChange(-5, -10)).toBe(-50);
  });
});

// ---------------------------------------------------------------------------
// isSignificantChange
// ---------------------------------------------------------------------------

describe("isSignificantChange", () => {
  it("returns false when spend is 0", () => {
    expect(isSignificantChange(50, 0)).toBe(false);
  });

  it("returns false when spend is negative", () => {
    expect(isSignificantChange(50, -100)).toBe(false);
  });

  it("uses benchmark variance when provided", () => {
    // 2x benchmark variance = 20%. A 25% change exceeds that.
    expect(isSignificantChange(25, 1000, 10)).toBe(true);
    // 15% does not exceed 2x10%
    expect(isSignificantChange(15, 1000, 10)).toBe(false);
  });

  it("considers direction irrelevant (uses abs value)", () => {
    expect(isSignificantChange(-25, 1000, 10)).toBe(true);
    expect(isSignificantChange(25, 1000, 10)).toBe(true);
  });

  it("uses spend-based heuristic when no benchmark provided", () => {
    // At $100 spend: minDetectable = 100/sqrt(100) = 10%
    expect(isSignificantChange(15, 100)).toBe(true);
    expect(isSignificantChange(5, 100)).toBe(false);
  });

  it("has tighter thresholds for higher spend", () => {
    // At $10000 spend: minDetectable = 100/sqrt(10000) = 1%, capped at 5%
    expect(isSignificantChange(6, 10000)).toBe(true);
    expect(isSignificantChange(3, 10000)).toBe(false);
  });

  it("caps minimum detectable at 50% for very low spend", () => {
    // At $1 spend: 100/sqrt(1) = 100, but capped at 50%
    expect(isSignificantChange(55, 1)).toBe(true);
    expect(isSignificantChange(45, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// zScore
// ---------------------------------------------------------------------------

describe("zScore", () => {
  it("returns null when fewer than 3 historical values", () => {
    expect(zScore(10, [5, 15])).toBeNull();
    expect(zScore(10, [])).toBeNull();
  });

  it("computes z-score correctly", () => {
    // history: [10, 10, 10], mean=10, stdDev=0 → value=10 → 0
    expect(zScore(10, [10, 10, 10])).toBe(0);
  });

  it("returns null when stdDev is 0 and value differs from mean", () => {
    // All same values, value differs
    expect(zScore(20, [10, 10, 10])).toBeNull();
  });

  it("computes positive z-score for values above mean", () => {
    // history: [2, 4, 6], mean=4, variance=8/3, stdDev=sqrt(8/3)
    const result = zScore(8, [2, 4, 6]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  it("computes negative z-score for values below mean", () => {
    const result = zScore(0, [2, 4, 6]);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });
});
