import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("contrast util (WCAG relative luminance)", () => {
  it("white text on the AA action amber (30 58% 41%) passes AA (≥ 4.5)", () => {
    // Pure-white foreground is required: 98%-white only reaches ~4.33 here.
    expect(contrastRatio("0 0% 100%", "30 58% 41%")).toBeGreaterThanOrEqual(4.5);
  });

  it("the OLD amber (30 55% 46%) fails AA even against pure white — locks the darkening", () => {
    expect(contrastRatio("0 0% 100%", "30 55% 46%")).toBeLessThan(4.5);
  });

  it("black/white is the canonical 21:1", () => {
    expect(contrastRatio("0 0% 0%", "0 0% 100%")).toBeCloseTo(21, 0);
  });

  it("luminance endpoints: white ≈ 1, black ≈ 0", () => {
    expect(relativeLuminance("0 0% 100%")).toBeCloseTo(1, 5);
    expect(relativeLuminance("0 0% 0%")).toBeCloseTo(0, 5);
  });
});
