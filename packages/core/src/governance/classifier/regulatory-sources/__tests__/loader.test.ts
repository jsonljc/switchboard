import { describe, it, expect, beforeEach } from "vitest";
import { loadRegulatoryPublicSources } from "../loader.js";
import { _resetRegulatorySourceCache } from "../loader.js";

beforeEach(() => {
  _resetRegulatorySourceCache();
});

describe("loadRegulatoryPublicSources", () => {
  it("returns a non-empty SG table", () => {
    const sg = loadRegulatoryPublicSources("SG");
    expect(sg.length).toBeGreaterThanOrEqual(12); // ≥3 entries × 4 categories
  });

  it("returns a non-empty MY table", () => {
    const my = loadRegulatoryPublicSources("MY");
    expect(my.length).toBeGreaterThanOrEqual(12);
  });

  it("freezes the returned array", () => {
    const sg = loadRegulatoryPublicSources("SG");
    expect(Object.isFrozen(sg)).toBe(true);
  });

  it("guarantees unique ids per jurisdiction", () => {
    for (const j of ["SG", "MY"] as const) {
      const ids = new Set<string>();
      for (const entry of loadRegulatoryPublicSources(j)) {
        expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
        ids.add(entry.id);
      }
    }
  });

  it("strips the g flag from all RegExp patterns", () => {
    for (const j of ["SG", "MY"] as const) {
      for (const entry of loadRegulatoryPublicSources(j)) {
        for (const p of entry.patterns) {
          if (p instanceof RegExp) {
            expect(p.flags.includes("g")).toBe(false);
            expect(p.flags.includes("i")).toBe(true);
          }
        }
      }
    }
  });

  it("returns the same frozen instance on repeated calls (memoization)", () => {
    expect(loadRegulatoryPublicSources("SG")).toBe(loadRegulatoryPublicSources("SG"));
  });
});
