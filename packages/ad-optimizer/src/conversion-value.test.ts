import { describe, it, expect } from "vitest";
import { normalizeConversionValue } from "./conversion-value.js";

describe("normalizeConversionValue", () => {
  it("converts cents to major currency units", () => {
    expect(normalizeConversionValue(320000)).toBe(3200);
    expect(normalizeConversionValue(28000)).toBe(280);
  });

  it("handles zero and fractional cents", () => {
    expect(normalizeConversionValue(0)).toBe(0);
    expect(normalizeConversionValue(12345)).toBe(123.45);
  });
});
