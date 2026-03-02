/**
 * ConversationCompressor — compresses conversation history to preserve context
 * while reducing token usage.
 *
 * Strategy:
 * 1. Keep the N most recent messages as-is
 * 2. For older messages, extract action types + outcomes deterministically
 * 3. Produce a compressed context summary
 */

export interface CompressedContext {
  /** Summary of older conversation history */
  summary: string;
  /** Recent messages kept verbatim */
  recentMessages: Array<{ role: string; text: string }>;
  /** Extracted action history from compressed messages */
  actionHistory: Array<{
    actionType: string;
    outcome: string;
    timestamp?: string;
  }>;
}

/**
 * Patterns to extract action types and outcomes from messages.
 */
const ACTION_PATTERNS = [
  // "Paused campaign X" / "Resumed campaign X"
  { regex: /(?:paused|resumed|adjusted|modified|created|deleted|cancelled|stopped)\s+(.+)/i, extract: (m: RegExpMatchArray) => ({ actionType: m[0]!.split(/\s+/)[0]!, outcome: m[0]! }) },
  // "Budget changed to $X" / "Budget set to $X"
  { regex: /budget\s+(?:changed|set|adjusted)\s+to\s+\$?(\d+)/i, extract: (m: RegExpMatchArray) => ({ actionType: "budget_adjust", outcome: m[0]! }) },
  // "[Approval Required]"
  { regex: /\[Approval Required\]\s+(.+)/i, extract: (m: RegExpMatchArray) => ({ actionType: "approval_requested", outcome: m[1]! }) },
  // "Action rejected"
  { regex: /Action rejected/i, extract: () => ({ actionType: "action_rejected", outcome: "rejected" }) },
  // Execution results
  { regex: /(?:executed|completed|failed|denied)/i, extract: (m: RegExpMatchArray) => ({ actionType: "execution", outcome: m[0]! }) },
];

export class ConversationCompressor {
  private recentCount: number;
  private compressionThreshold: number;

  constructor(config?: {
    /** Number of recent messages to keep verbatim (default: 6) */
    recentCount?: number;
    /** Minimum messages before compression kicks in (default: 10) */
    compressionThreshold?: number;
  }) {
    this.recentCount = config?.recentCount ?? 6;
    this.compressionThreshold = config?.compressionThreshold ?? 10;
  }

  /**
   * Compress conversation messages if they exceed the threshold.
   * Returns null if no compression needed.
   */
  compress(
    messages: Array<{ role: string; text: string; timestamp?: Date }>,
  ): CompressedContext | null {
    if (messages.length <= this.compressionThreshold) {
      return null; // No compression needed
    }

    const splitPoint = messages.length - this.recentCount;
    const olderMessages = messages.slice(0, splitPoint);
    const recentMessages = messages.slice(splitPoint).map((m) => ({
      role: m.role,
      text: m.text,
    }));

    // Extract action history from older messages
    const actionHistory = this.extractActionHistory(olderMessages);

    // Build deterministic summary
    const summary = this.buildSummary(olderMessages, actionHistory);

    return {
      summary,
      recentMessages,
      actionHistory,
    };
  }

  /**
   * Extract action types and outcomes from messages.
   */
  private extractActionHistory(
    messages: Array<{ role: string; text: string }>,
  ): CompressedContext["actionHistory"] {
    const history: CompressedContext["actionHistory"] = [];

    for (const msg of messages) {
      if (msg.role !== "assistant") continue;

      for (const pattern of ACTION_PATTERNS) {
        const match = msg.text.match(pattern.regex);
        if (match) {
          const extracted = pattern.extract(match);
          history.push(extracted);
          break; // One action per message
        }
      }
    }

    return history;
  }

  /**
   * Build a compressed summary of older messages.
   */
  private buildSummary(
    messages: Array<{ role: string; text: string }>,
    actionHistory: CompressedContext["actionHistory"],
  ): string {
    const userQuestions = messages
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .slice(0, 5); // Max 5 historical questions

    const parts: string[] = [];

    if (userQuestions.length > 0) {
      parts.push(`Earlier topics: ${userQuestions.join("; ")}`);
    }

    if (actionHistory.length > 0) {
      const actionSummary = actionHistory
        .map((a) => `${a.actionType}: ${a.outcome}`)
        .join(", ");
      parts.push(`Actions taken: ${actionSummary}`);
    }

    if (parts.length === 0) {
      parts.push(`${messages.length} earlier messages exchanged`);
    }

    return parts.join(". ") + ".";
  }
}
