/**
 * Crude sentence splitter shared by 1b-1's escalation-trigger scanner
 * (inbound) and 1b-2's claim classifier (outbound). Greedy split on
 * [.!?\n]+ with whitespace tolerance. Sentence-tokenizer dependency
 * is overkill for short chat text; edge cases (no punctuation, "...",
 * embedded URLs) are accepted false-positive risk covered by fixtures.
 */
export function splitSentences(text: string): readonly string[] {
  const result: string[] = [];
  let segmentStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
      pushIfNonEmpty(text, segmentStart, i, result);
      segmentStart = i + 1;
    }
  }
  pushIfNonEmpty(text, segmentStart, text.length, result);
  return result;
}

function pushIfNonEmpty(
  text: string,
  segmentStart: number,
  segmentEnd: number,
  result: string[],
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
    result.push(text.slice(trimmedStart, trimmedEnd));
  }
}
