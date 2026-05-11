import { describe, it, expect, beforeEach } from "vitest";
import { loadRegulatoryPublicSources } from "../loader.js";
import { _resetRegulatorySourceCache } from "../loader.js";
import type { RegulatoryPublicSourceCategory } from "../types.js";

beforeEach(() => {
  _resetRegulatorySourceCache();
});

const CATEGORIES: ReadonlyArray<RegulatoryPublicSourceCategory> = [
  "approved_device",
  "approved_clinic_claim",
  "doctor_credential_path",
  "named_certification",
];

describe("MY regulatory public sources", () => {
  it("has at least 3 entries per category", () => {
    const my = loadRegulatoryPublicSources("MY");
    for (const cat of CATEGORIES) {
      const subset = my.filter((e) => e.category === cat);
      expect(subset.length, `MY ${cat} entries`).toBeGreaterThanOrEqual(3);
    }
  });

  it("all entries are jurisdiction=MY", () => {
    const my = loadRegulatoryPublicSources("MY");
    for (const e of my) expect(e.jurisdiction).toBe("MY");
  });

  it("names MDA, KKM, or MMC as authority", () => {
    const my = loadRegulatoryPublicSources("MY");
    const authorities = new Set(my.map((e) => e.authority));
    expect([...authorities].some((a) => /MDA|KKM|MMC/i.test(a))).toBe(true);
  });

  it("all entries have non-empty sources array", () => {
    const my = loadRegulatoryPublicSources("MY");
    for (const e of my) {
      expect(e.sources.length, `${e.id} sources`).toBeGreaterThan(0);
    }
  });

  it("all entries have non-empty patterns array", () => {
    const my = loadRegulatoryPublicSources("MY");
    for (const e of my) {
      expect(e.patterns.length, `${e.id} patterns`).toBeGreaterThan(0);
    }
  });
});
