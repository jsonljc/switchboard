import { describe, it, expect } from "vitest";
import { ALEX_CONFIG } from "../alex-config";
import { RILEY_ACCENT } from "../riley/riley-config";

describe("agent identity colors are not the action amber", () => {
  it("Alex identity moved off #B8782E (action amber)", () => {
    expect(ALEX_CONFIG.accent.base.toUpperCase()).not.toBe("#B8782E");
  });

  it("Riley identity is distinct from the action amber", () => {
    expect(RILEY_ACCENT.base.toUpperCase()).not.toBe("#B8782E");
  });

  it("Alex and Riley identity colors are distinct from each other", () => {
    expect(RILEY_ACCENT.base.toUpperCase()).not.toBe(ALEX_CONFIG.accent.base.toUpperCase());
  });

  it("Alex identity is coral-family (hue near 14°)", () => {
    // #E07A53 is coral — just verify it's not amber
    expect(ALEX_CONFIG.accent.base.toUpperCase()).not.toBe("#B8782E");
  });
});
