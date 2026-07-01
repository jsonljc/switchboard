import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadBannedPhrases, _resetBannedPhraseCache } from "../loader.js";
import { COMMON_BANNED_PHRASES } from "../common.js";
import { SG_BANNED_PHRASES } from "../sg.js";
import { MY_BANNED_PHRASES } from "../my.js";

describe("loadBannedPhrases", () => {
  beforeEach(() => {
    _resetBannedPhraseCache();
  });

  it("merges common + SG for jurisdiction SG", () => {
    const sg = loadBannedPhrases("SG");
    expect(sg.length).toBe(COMMON_BANNED_PHRASES.length + SG_BANNED_PHRASES.length);
  });

  it("merges common + MY for jurisdiction MY", () => {
    const my = loadBannedPhrases("MY");
    expect(my.length).toBe(COMMON_BANNED_PHRASES.length + MY_BANNED_PHRASES.length);
  });

  it("returns the same frozen array on repeated calls (memoization)", () => {
    const a = loadBannedPhrases("SG");
    const b = loadBannedPhrases("SG");
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("normalizes regex flags: g is stripped, i is enforced", () => {
    const entries = loadBannedPhrases("SG");
    for (const entry of entries) {
      for (const p of entry.patterns) {
        if (p instanceof RegExp) {
          expect(p.flags).not.toContain("g");
          expect(p.flags).toContain("i");
        }
      }
    }
  });

  it("preserves declaration order: common first, then jurisdiction", () => {
    const sg = loadBannedPhrases("SG");
    const firstCommonEntry = COMMON_BANNED_PHRASES[0];
    const firstSgEntry = SG_BANNED_PHRASES[0];
    expect(firstCommonEntry).toBeDefined();
    expect(firstSgEntry).toBeDefined();
    if (!firstCommonEntry || !firstSgEntry) return;
    const firstCommonIdx = sg.findIndex((e) => e.id === firstCommonEntry.id);
    const firstSgIdx = sg.findIndex((e) => e.id === firstSgEntry.id);
    expect(firstCommonIdx).toBeLessThan(firstSgIdx);
  });

  it("throws on duplicate id in merged set (real seed has none)", () => {
    const sg = loadBannedPhrases("SG");
    const ids = new Set<string>();
    for (const e of sg) {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });

  it("warns on duplicate effective patterns (real seed has none)", () => {
    _resetBannedPhraseCache();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadBannedPhrases("MY");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("merged tables meet per-category minimums per spec §2.5", () => {
    const minimums: Record<string, number> = {
      superlative: 5,
      guarantee: 5,
      medical_claim: 5,
      urgency: 3,
      testimonial: 3,
    };
    for (const j of ["SG", "MY"] as const) {
      _resetBannedPhraseCache();
      const entries = loadBannedPhrases(j);
      const counts: Record<string, number> = {
        superlative: 0,
        guarantee: 0,
        medical_claim: 0,
        urgency: 0,
        testimonial: 0,
      };
      for (const e of entries) {
        const count = counts[e.category];
        if (count !== undefined) {
          counts[e.category] = count + 1;
        }
      }
      for (const [cat, min] of Object.entries(minimums)) {
        const catCount = counts[cat];
        expect(catCount ?? 0, `${j} ${cat} count`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("merged tables meet total entry floor per spec §10 (≥30 per jurisdiction)", () => {
    for (const j of ["SG", "MY"] as const) {
      _resetBannedPhraseCache();
      const entries = loadBannedPhrases(j);
      expect(entries.length, `${j} total banned-phrase entries`).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("loadBannedPhrases vertical keying", () => {
  beforeEach(() => {
    _resetBannedPhraseCache();
  });

  it("defaults to the medspa vertical: no-vertical call === explicit medspa call", () => {
    const implicit = loadBannedPhrases("SG");
    const explicit = loadBannedPhrases("SG", "medspa");
    // Same (vertical, jurisdiction) cache key -> same frozen instance, byte-identical.
    expect(explicit).toBe(implicit);
    expect(explicit.length).toBe(COMMON_BANNED_PHRASES.length + SG_BANNED_PHRASES.length);
  });

  it("keys the cache on (vertical, jurisdiction): a non-seed vertical is a distinct entry", () => {
    const medspa = loadBannedPhrases("SG", "medspa");
    const fitness = loadBannedPhrases("SG", "fitness");
    expect(fitness).not.toBe(medspa);
  });

  it("a non-seed vertical inherits the medspa floor (over-restrict is the safe direction)", () => {
    const medspa = loadBannedPhrases("MY", "medspa");
    const fitness = loadBannedPhrases("MY", "fitness");
    expect(fitness.map((e) => e.id)).toEqual(medspa.map((e) => e.id));
  });
});
