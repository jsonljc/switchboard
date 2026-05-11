import { describe, it, expect } from "vitest";
import { loadRevocationKeywords } from "../loader.js";

describe("loadRevocationKeywords", () => {
  it("returns a frozen array for SG", () => {
    const entries = loadRevocationKeywords("SG");
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns a frozen array for MY", () => {
    const entries = loadRevocationKeywords("MY");
    expect(Object.isFrozen(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("all entries have unique ids within a jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      const entries = loadRevocationKeywords(j);
      const ids = entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("regex patterns are normalized: case-insensitive, no global flag", () => {
    for (const j of ["SG", "MY"] as const) {
      for (const entry of loadRevocationKeywords(j)) {
        for (const p of entry.patterns) {
          if (p instanceof RegExp) {
            expect(p.flags).toContain("i");
            expect(p.flags).not.toContain("g");
          }
        }
      }
    }
  });

  it("is memoized — second call returns the same reference", () => {
    expect(loadRevocationKeywords("SG")).toBe(loadRevocationKeywords("SG"));
  });

  it("includes baseline STOP and unsubscribe across both jurisdictions", () => {
    for (const j of ["SG", "MY"] as const) {
      const entries = loadRevocationKeywords(j);
      const haystack = entries.flatMap((e) => e.patterns.map((p) => String(p)));
      expect(haystack.some((s) => /STOP/i.test(s))).toBe(true);
      expect(haystack.some((s) => /unsubscribe/i.test(s))).toBe(true);
    }
  });
});
