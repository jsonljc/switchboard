import type { RevocationKeywordEntry } from "../revocation-keywords/types.js";

export interface RevocationKeywordMatch {
  entry: RevocationKeywordEntry;
  matched: string;
  index: number;
}

/**
 * Scan inbound text for revocation keyword matches.
 * Pure function. NOT sentence-bounded — revocation in any sentence of the
 * inbound counts (user intent is the message, not the surrounding clauses).
 *
 * Returns ALL matches; caller uses `matches[0]` in 1c (multi-match analytics
 * deferred).
 */
export function scanForRevocationKeywords(
  text: string,
  entries: ReadonlyArray<RevocationKeywordEntry>,
): RevocationKeywordMatch[] {
  const matches: RevocationKeywordMatch[] = [];
  const lower = text.toLowerCase();

  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      if (typeof pattern === "string") {
        const idx = lower.indexOf(pattern.toLowerCase());
        if (idx >= 0) {
          matches.push({
            entry,
            matched: text.slice(idx, idx + pattern.length),
            index: idx,
          });
          break; // one match per entry is enough
        }
      } else {
        // RegExp — already normalized to case-insensitive, non-global at load time.
        const result = pattern.exec(text);
        if (result) {
          matches.push({
            entry,
            matched: result[0],
            index: result.index,
          });
          break;
        }
      }
    }
  }
  return matches;
}
