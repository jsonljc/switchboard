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

/** Crude sentence splitter — adequate for chat text per spec §4.3. */
function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const re = /([^.!?\n]+(?:[.!?]+|\n+|$))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const firstChar = trimmed[0];
    if (firstChar === undefined) continue;
    const start = m.index + raw.indexOf(firstChar);
    spans.push({ text: trimmed, start });
  }
  return spans;
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
