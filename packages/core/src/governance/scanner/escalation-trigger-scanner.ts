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

interface MatchSpan {
  start: number;
  end: number;
}

/**
 * All occurrences of a pattern in `text` as [start, end) spans.
 *
 * String patterns advance past each match, so they do not report overlapping
 * occurrences ("aaa" matches "aa" once): a deliberate semantic choice, fine
 * for word-like trigger terms.
 */
function allMatchSpans(text: string, pattern: string | RegExp): MatchSpan[] {
  const spans: MatchSpan[] = [];
  if (typeof pattern === "string") {
    if (pattern.length === 0) return spans;
    const hay = text.toLowerCase();
    const needle = pattern.toLowerCase();
    let idx = hay.indexOf(needle);
    while (idx >= 0) {
      spans.push({ start: idx, end: idx + needle.length });
      idx = hay.indexOf(needle, idx + needle.length);
    }
    return spans;
  }
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return spans;
}

function overlaps(a: MatchSpan, b: MatchSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Per-MATCH negation suppression (supersedes 1b-1's per-entry rule, the
 * limitation documented in #843): a pattern occurrence is suppressed iff its
 * span overlaps a negation match span in the same sentence. A run-on sentence
 * mixing a negated clause with a separate genuine disclosure ("I'm not on
 * aspirin but I do take warfarin daily") now reports the genuine one.
 *
 * Overlap (not containment) is required: windowed negations like
 * "not [window] combine" end inside a wider pattern match ("combine ... filler")
 * and must still suppress it.
 *
 * Each entry still reports at most one match per sentence (the first
 * unsuppressed occurrence of the first matching pattern).
 */
export function scanForEscalationTriggers(
  text: string,
  entries: ReadonlyArray<EscalationTriggerEntry>,
): EscalationTriggerMatch[] {
  const sentences = toSentenceSpans(text);
  const matches: EscalationTriggerMatch[] = [];

  for (const entry of entries) {
    for (const sentence of sentences) {
      const negationSpans = (entry.negations ?? []).flatMap((n) => allMatchSpans(sentence.text, n));
      let reported = false;
      for (const pattern of entry.patterns) {
        for (const occurrence of allMatchSpans(sentence.text, pattern)) {
          if (negationSpans.some((neg) => overlaps(neg, occurrence))) continue;
          matches.push({
            entry,
            matched: sentence.text.slice(occurrence.start, occurrence.end),
            index: sentence.start + occurrence.start,
            sentence: sentence.text,
          });
          reported = true;
          break;
        }
        if (reported) break;
      }
    }
  }

  return matches;
}
