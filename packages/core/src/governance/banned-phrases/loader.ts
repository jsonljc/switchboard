import type { BannedPhraseEntry } from "./types.js";
import { COMMON_BANNED_PHRASES } from "./common.js";
import { SG_BANNED_PHRASES } from "./sg.js";
import { MY_BANNED_PHRASES } from "./my.js";

function normalizePattern(p: string | RegExp): string | RegExp {
  if (typeof p === "string") return p;
  const flags = p.flags.replace(/g/g, "");
  return new RegExp(p.source, flags.includes("i") ? flags : flags + "i");
}

function normalizeEntry(entry: BannedPhraseEntry): BannedPhraseEntry {
  return {
    ...entry,
    patterns: entry.patterns.map(normalizePattern),
  };
}

const cache = new Map<"SG" | "MY", ReadonlyArray<BannedPhraseEntry>>();

export function loadBannedPhrases(jurisdiction: "SG" | "MY"): ReadonlyArray<BannedPhraseEntry> {
  const cached = cache.get(jurisdiction);
  if (cached) return cached;

  const merged: BannedPhraseEntry[] = [
    ...COMMON_BANNED_PHRASES,
    ...(jurisdiction === "SG" ? SG_BANNED_PHRASES : MY_BANNED_PHRASES),
  ].map(normalizeEntry);

  // Assert ID uniqueness
  const seen = new Set<string>();
  for (const entry of merged) {
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate banned-phrase id "${entry.id}" in ${jurisdiction} merged set`);
    }
    seen.add(entry.id);
  }

  // Warn on duplicate effective patterns
  const patternKey = (p: string | RegExp): string =>
    typeof p === "string" ? `s:${p.toLowerCase()}` : `r:${p.source}`;
  const patternIndex = new Map<string, string>();
  for (const entry of merged) {
    for (const p of entry.patterns) {
      const key = patternKey(p);
      const prev = patternIndex.get(key);
      if (prev && prev !== entry.id) {
        console.warn(
          `Banned-phrase duplicate pattern in ${jurisdiction}: "${key}" appears in both ${prev} and ${entry.id}`,
        );
      }
      patternIndex.set(key, entry.id);
    }
  }

  const frozen = Object.freeze(merged);
  cache.set(jurisdiction, frozen);
  return frozen;
}

export function _resetBannedPhraseCache(): void {
  cache.clear();
}
