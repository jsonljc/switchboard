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

describe("SG regulatory public sources", () => {
  it("has at least 3 entries per category", () => {
    const sg = loadRegulatoryPublicSources("SG");
    for (const cat of CATEGORIES) {
      const subset = sg.filter((e) => e.category === cat);
      expect(subset.length, `SG ${cat} entries`).toBeGreaterThanOrEqual(3);
    }
  });

  it("all entries are jurisdiction=SG", () => {
    const sg = loadRegulatoryPublicSources("SG");
    for (const e of sg) expect(e.jurisdiction).toBe("SG");
  });

  it("names HSA, MOH, or SMC as authority", () => {
    const sg = loadRegulatoryPublicSources("SG");
    const authorities = new Set(sg.map((e) => e.authority));
    expect([...authorities].some((a) => /HSA|MOH|SMC/i.test(a))).toBe(true);
  });

  it("all entries have non-empty sources array", () => {
    const sg = loadRegulatoryPublicSources("SG");
    for (const e of sg) {
      expect(e.sources.length, `${e.id} sources`).toBeGreaterThan(0);
    }
  });

  it("all entries have non-empty patterns array", () => {
    const sg = loadRegulatoryPublicSources("SG");
    for (const e of sg) {
      expect(e.patterns.length, `${e.id} patterns`).toBeGreaterThan(0);
    }
  });
});
