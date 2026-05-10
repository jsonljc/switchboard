import type { BannedPhraseEntry } from "../banned-phrases/types.js";

export interface BannedPhraseMatch {
  entry: BannedPhraseEntry;
  matched: string;
  index: number;
}

export function scanForBannedPhrases(
  text: string,
  entries: ReadonlyArray<BannedPhraseEntry>,
): BannedPhraseMatch[] {
  const matches: BannedPhraseMatch[] = [];
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
          break;
        }
      } else {
        const re = new RegExp(pattern.source, pattern.flags);
        const m = re.exec(text);
        if (m) {
          matches.push({ entry, matched: m[0], index: m.index });
          break;
        }
      }
    }
  }

  return matches;
}
