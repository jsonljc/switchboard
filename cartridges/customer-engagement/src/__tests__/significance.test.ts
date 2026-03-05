// ---------------------------------------------------------------------------
// Tests: Significance
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { percentChange, isSignificantChange, zScore } from "../core/analysis/significance.js";

describe("percentChange", () => {
  it("should compute basic percentage change", () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
  });

  it("should return 0 when both values are 0", () => {
    expect(percentChange(0, 0)).toBe(0);
  });

  it("should return 100 when previous is 0 and current is positive", () => {
    expect(percentChange(50, 0)).toBe(100);
  });

  it("should return -100 when previous is 0 and current is negative", () => {
    expect(percentChange(-50, 0)).toBe(-100);
  });
});

describe("isSignificantChange", () => {
  it("should return false for zero contacts", () => {
    expect(isSignificantChange(50, 0)).toBe(false);
  });

  it("should flag large changes with small volume", () => {
    expect(isSignificantChange(60, 10)).toBe(true);
  });

  it("should flag smaller changes with large volume", () => {
    expect(isSignificantChange(8, 1000)).toBe(true);
  });

  it("should use benchmark variance when provided", () => {
    expect(isSignificantChange(15, 100, 10)).toBe(false); // 15 < 10*2
    expect(isSignificantChange(25, 100, 10)).toBe(true); // 25 > 10*2
  });
});

describe("zScore", () => {
  it("should return null with insufficient data", () => {
    expect(zScore(5, [1, 2])).toBeNull();
  });

  it("should return 0 for mean value", () => {
    expect(zScore(5, [5, 5, 5])).toBe(0);
  });

  it("should return positive for above-mean values", () => {
    const z = zScore(10, [4, 5, 6, 5]);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(0);
  });
});
