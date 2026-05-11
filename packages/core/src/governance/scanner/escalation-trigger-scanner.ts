import type { EscalationTriggerEntry } from "../escalation-triggers/types.js";
import { splitSentences } from "../text/sentence-splitter.js";

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
 * Wraps the shared splitSentences utility and annotates each sentence with
 * its start offset in the original text. Used internally for absolute-index
 * reporting in EscalationTriggerMatch.
 */
function toSentenceSpans(text: string): SentenceSpan[] {
  const sentences = splitSentences(text);
  const spans: SentenceSpan[] = [];
  let searchFrom = 0;
  for (const sentence of sentences) {
    const start = text.indexOf(sentence, searchFrom);
    if (start !== -1) {
      spans.push({ text: sentence, start });
      searchFrom = start + sentence.length;
    }
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
  const sentences = toSentenceSpans(text);
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
