// ---------------------------------------------------------------------------
// Variation Pool Manager — prevents repetitive response patterns
// ---------------------------------------------------------------------------

import type { VariationControl } from "./types.js";

type OpeningStyle = "direct" | "empathetic" | "curious" | "light";

const OPENING_STYLES: OpeningStyle[] = ["direct", "empathetic", "curious", "light"];

interface SessionRecord {
  usedPhrases: Set<string>;
  lastStyles: OpeningStyle[];
}

export class VariationPool {
  private sessions = new Map<string, SessionRecord>();

  /** Get variation control for a session and move. */
  getVariationControl(sessionId: string, _move: string): VariationControl {
    const record = this.getOrCreateSession(sessionId);

    // Pick an opening style that hasn't been used recently
    const style = this.pickStyle(record.lastStyles);
    record.lastStyles.push(style);
    if (record.lastStyles.length > 4) {
      record.lastStyles.shift();
    }

    return {
      openingStyle: style,
      recentlyUsedPhrases: [...record.usedPhrases].slice(-10),
      avoidPatterns: [...record.usedPhrases].slice(-5),
    };
  }

  /** Record phrases that were used in a response. */
  recordUsed(sessionId: string, phrases: string[]): void {
    const record = this.getOrCreateSession(sessionId);
    for (const phrase of phrases) {
      record.usedPhrases.add(phrase);
    }
    // Cap stored phrases at 50
    if (record.usedPhrases.size > 50) {
      const arr = [...record.usedPhrases];
      record.usedPhrases = new Set(arr.slice(-30));
    }
  }

  /** Clear session data. */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private getOrCreateSession(sessionId: string): SessionRecord {
    let record = this.sessions.get(sessionId);
    if (!record) {
      record = { usedPhrases: new Set(), lastStyles: [] };
      this.sessions.set(sessionId, record);
    }
    return record;
  }

  private pickStyle(recentStyles: OpeningStyle[]): OpeningStyle {
    // Avoid the last 2 styles used
    const avoid = new Set(recentStyles.slice(-2));
    const candidates = OPENING_STYLES.filter((s) => !avoid.has(s));
    if (candidates.length === 0) return OPENING_STYLES[0]!;
    return candidates[Math.floor(Math.random() * candidates.length)]!;
  }
}
