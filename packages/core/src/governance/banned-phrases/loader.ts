import type { BannedPhraseEntry } from "./types.js";
import { COMMON_BANNED_PHRASES, COMMON_BANNED_PHRASES_BY_VERTICAL } from "./common.js";
import { SG_BANNED_PHRASES, SG_BANNED_PHRASES_BY_VERTICAL } from "./sg.js";
import { MY_BANNED_PHRASES, MY_BANNED_PHRASES_BY_VERTICAL } from "./my.js";
import { normalizeRegex } from "../text/regex.js";
import { DEFAULT_VERTICAL, type Vertical } from "../../vertical.js";

function normalizePattern(p: string | RegExp): string | RegExp {
  if (typeof p === "string") return p;
  return normalizeRegex(p);
}

function normalizeEntry(entry: BannedPhraseEntry): BannedPhraseEntry {
  return {
    ...entry,
    patterns: entry.patterns.map(normalizePattern),
  };
}

// Cache keyed on (vertical, jurisdiction), the composite the loader now keys on.
const cache = new Map<string, ReadonlyArray<BannedPhraseEntry>>();

/**
 * Load the merged banned-phrase table for a (vertical, jurisdiction) pair.
 *
 * `jurisdiction` stays the FIRST positional param and `vertical` is an optional
 * second param defaulting to `medspa`, so every existing single-arg caller (and
 * the by-reference `bannedPhraseLoader: loadBannedPhrases` wiring) stays
 * byte-identical: same merged set, same order, same frozen instance per key.
 * A vertical without its own table inherits the medspa seed floor (over-restrict
 * is the safe direction until that vertical's pack lands).
 */
export function loadBannedPhrases(
  jurisdiction: "SG" | "MY",
  vertical: Vertical = DEFAULT_VERTICAL,
): ReadonlyArray<BannedPhraseEntry> {
  const cacheKey = `${vertical}:${jurisdiction}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const common = COMMON_BANNED_PHRASES_BY_VERTICAL[vertical] ?? COMMON_BANNED_PHRASES;
  const jurisdictionTable =
    jurisdiction === "SG"
      ? (SG_BANNED_PHRASES_BY_VERTICAL[vertical] ?? SG_BANNED_PHRASES)
      : (MY_BANNED_PHRASES_BY_VERTICAL[vertical] ?? MY_BANNED_PHRASES);

  const merged: BannedPhraseEntry[] = [...common, ...jurisdictionTable].map(normalizeEntry);

  // Assert ID uniqueness
  const seen = new Set<string>();
  for (const entry of merged) {
    if (seen.has(entry.id)) {
      throw new Error(
        `Duplicate banned-phrase id "${entry.id}" in ${vertical}/${jurisdiction} merged set`,
      );
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
          `Banned-phrase duplicate pattern in ${vertical}/${jurisdiction}: "${key}" appears in both ${prev} and ${entry.id}`,
        );
      }
      patternIndex.set(key, entry.id);
    }
  }

  const frozen = Object.freeze(merged);
  cache.set(cacheKey, frozen);
  return frozen;
}

export function _resetBannedPhraseCache(): void {
  cache.clear();
}
