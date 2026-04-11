import { describe, it, expect } from "vitest";
import { slugify } from "../onboard.js";

describe("slugify", () => {
  it("converts business name to slug", () => {
    expect(slugify("Austin Bakery")).toBe("austin-bakery");
  });

  it("removes special characters", () => {
    expect(slugify("Bob's Pizza & Pasta")).toBe("bobs-pizza-pasta");
  });

  it("handles collision suffix", () => {
    expect(slugify("Austin Bakery", 2)).toBe("austin-bakery-2");
  });

  it("trims and collapses dashes", () => {
    expect(slugify("  The   Great   Place  ")).toBe("the-great-place");
  });
});
