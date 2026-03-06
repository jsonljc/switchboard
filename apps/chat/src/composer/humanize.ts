import type { ApprovalCardPayload, ResultCardPayload } from "../adapters/adapter.js";

/**
 * Post-processes outgoing messages to make them conversational
 * and apply skin-specific terminology substitutions.
 */
export class ResponseHumanizer {
  private replacements: Array<{ pattern: RegExp; replacement: string }>;

  constructor(terminology: Record<string, string> = {}) {
    // Pre-compile word-boundary-aware regexes for each term.
    // Sort by length descending so longer terms match first (e.g. "campaign budget" before "campaign").
    this.replacements = Object.entries(terminology)
      .sort(([a], [b]) => b.length - a.length)
      .map(([from, to]) => ({
        pattern: new RegExp(`\\b${escapeRegex(from)}(s)?\\b`, "gi"),
        replacement: to,
      }));
  }

  /** Replace domain terms with skin-specific terminology (word-boundary-aware). */
  applyTerminology(text: string): string {
    let result = text;
    for (const { pattern, replacement } of this.replacements) {
      result = result.replace(pattern, (_match, plural: string | undefined) =>
        plural ? replacement + "s" : replacement,
      );
    }
    return result;
  }

  /** Humanize a result card payload. */
  humanizeResultCard(card: ResultCardPayload): ResultCardPayload {
    const summary = this.applyTerminology(card.summary);
    return {
      ...card,
      summary: card.success
        ? `All set! ${summary}`
        : `Something went wrong: ${lowercaseFirst(summary)}.`,
    };
  }

  /** Humanize an approval card payload. */
  humanizeApprovalCard(card: ApprovalCardPayload): ApprovalCardPayload {
    // Strip the old "This action needs your approval:\n\n" prefix if present
    const rawSummary = card.summary.replace(/^This action needs your approval:\n\n/i, "");
    return {
      ...card,
      summary: this.applyTerminology(rawSummary),
      explanation: "I need your OK before proceeding.",
    };
  }

  /** Humanize a denial into conversational text. */
  humanizeDenial(explanation: string, humanDetail?: string): string {
    const detail = this.applyTerminology(humanDetail ?? explanation);
    return `I can't do that \u2014 ${lowercaseFirst(detail)}.`;
  }
}

function lowercaseFirst(s: string): string {
  if (!s) return s;
  return s[0]!.toLowerCase() + s.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
