import type { EscalationTriggerEntry } from "../escalation-triggers/types.js";

export interface EscalationTriggerMatch {
  entry: EscalationTriggerEntry;
  matched: string;
  index: number;
  sentence: string;
}

interface SentenceSpan {
  text: string;
  start: number;
}

/**
 * Crude sentence splitter — adequate for chat text per spec §4.3.
 *
 * Single-pass O(n) linear scan. The earlier regex-based implementation
 * (`/([^.!?\n]+(?:[.!?]+|\n+|$))/g`) was flagged by CodeQL as a polynomial
 * ReDoS — a malicious user could send a crafted string with many spaces to
 * trigger superlinear backtracking. This loop has no backtracking: each
 * character is visited exactly once.
 */
function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let segmentStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
      pushSpanIfNonEmpty(text, segmentStart, i, spans);
      segmentStart = i + 1;
    }
  }
  pushSpanIfNonEmpty(text, segmentStart, text.length, spans);
  return spans;
}

function pushSpanIfNonEmpty(
  text: string,
  segmentStart: number,
  segmentEnd: number,
  spans: SentenceSpan[],
): void {
  // Skip leading whitespace to find the trimmed start.
  let trimmedStart = segmentStart;
  while (trimmedStart < segmentEnd && /\s/.test(text[trimmedStart]!)) {
    trimmedStart++;
  }
  // Skip trailing whitespace to find the trimmed end.
  let trimmedEnd = segmentEnd;
  while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1]!)) {
    trimmedEnd--;
  }
  if (trimmedEnd > trimmedStart) {
    spans.push({ text: text.slice(trimmedStart, trimmedEnd), start: trimmedStart });
  }
}

function patternMatches(
  text: string,
  pattern: string | RegExp,
): { matched: string; index: number } | null {
  if (typeof pattern === "string") {
    const idx = text.toLowerCase().indexOf(pattern.toLowerCase());
    return idx >= 0 ? { matched: text.slice(idx, idx + pattern.length), index: idx } : null;
  }
  const re = new RegExp(pattern.source, pattern.flags);
  const m = re.exec(text);
  return m ? { matched: m[0], index: m.index } : null;
}

function anyMatches(text: string, patterns: ReadonlyArray<string | RegExp> | undefined): boolean {
  if (!patterns) return false;
  return patterns.some((p) => patternMatches(text, p) !== null);
}

export function scanForEscalationTriggers(
  text: string,
  entries: ReadonlyArray<EscalationTriggerEntry>,
): EscalationTriggerMatch[] {
  const sentences = splitSentences(text);
  const matches: EscalationTriggerMatch[] = [];

  for (const entry of entries) {
    for (const sentence of sentences) {
      if (anyMatches(sentence.text, entry.negations)) {
        continue;
      }
      for (const pattern of entry.patterns) {
        const m = patternMatches(sentence.text, pattern);
        if (m) {
          matches.push({
            entry,
            matched: m.matched,
            index: sentence.start + m.index,
            sentence: sentence.text,
          });
          break;
        }
      }
    }
  }

  return matches;
}
