// ---------------------------------------------------------------------------
// FAQ Matcher — matches inbound questions against a structured FAQ database
// with 3-tier confidence routing (direct, caveat, escalate)
// ---------------------------------------------------------------------------

import type { FAQRecord } from "@switchboard/schemas";

export interface FAQMatchResult {
  /** Matched FAQ record, if any */
  match: FAQRecord | null;
  /** Confidence score (0-1) */
  confidence: number;
  /** Routing tier: "direct" (>0.85), "caveat" (0.6-0.85), "escalate" (<0.6) */
  tier: "direct" | "caveat" | "escalate";
}

/** Confidence thresholds for routing tiers */
const DIRECT_THRESHOLD = 0.85;
const CAVEAT_THRESHOLD = 0.6;

/**
 * Match an inbound message against a list of FAQ records.
 *
 * Matching strategy:
 * 1. Exact match (case-insensitive) against question + variants → confidence 1.0
 * 2. Substring containment (question contains FAQ keyword or vice versa) → 0.7-0.9
 * 3. Token overlap (Jaccard similarity on word tokens) → 0.0-1.0
 */
export function matchFAQ(message: string, faqs: FAQRecord[]): FAQMatchResult {
  if (!faqs.length || !message.trim()) {
    return { match: null, confidence: 0, tier: "escalate" };
  }

  const normalizedMessage = normalize(message);
  let bestMatch: FAQRecord | null = null;
  let bestScore = 0;

  for (const faq of faqs) {
    const allPhrases = [faq.question, ...(faq.variants ?? [])];

    for (const phrase of allPhrases) {
      const normalizedPhrase = normalize(phrase);

      // Exact match
      if (normalizedMessage === normalizedPhrase) {
        return { match: faq, confidence: 1.0, tier: "direct" };
      }

      // Substring containment
      if (
        normalizedMessage.includes(normalizedPhrase) ||
        normalizedPhrase.includes(normalizedMessage)
      ) {
        const lengthRatio =
          Math.min(normalizedMessage.length, normalizedPhrase.length) /
          Math.max(normalizedMessage.length, normalizedPhrase.length);
        const score = 0.7 + 0.2 * lengthRatio;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = faq;
        }
        continue;
      }

      // Token overlap (Jaccard similarity)
      const messageTokens = tokenize(normalizedMessage);
      const phraseTokens = tokenize(normalizedPhrase);
      const jaccardScore = jaccard(messageTokens, phraseTokens);
      if (jaccardScore > bestScore) {
        bestScore = jaccardScore;
        bestMatch = faq;
      }
    }
  }

  const tier =
    bestScore >= DIRECT_THRESHOLD
      ? "direct"
      : bestScore >= CAVEAT_THRESHOLD
        ? "caveat"
        : "escalate";

  return {
    match: bestScore >= CAVEAT_THRESHOLD ? bestMatch : null,
    confidence: Math.round(bestScore * 100) / 100,
    tier,
  };
}

/**
 * Format an FAQ response based on the confidence tier.
 */
export function formatFAQResponse(result: FAQMatchResult, businessName?: string): string | null {
  if (!result.match) return null;

  if (result.tier === "direct") {
    return result.match.answer;
  }

  if (result.tier === "caveat") {
    const prefix = result.match.sensitive
      ? `Based on our general information${businessName ? ` at ${businessName}` : ""}, `
      : "";
    return (
      `${prefix}${result.match.answer}\n\n` +
      "Please note this is general information — " +
      "I'd recommend confirming the details with our team for your specific situation."
    );
  }

  return null;
}

// ── Internal helpers ──

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stop words to filter from token overlap */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "our",
  "it",
  "its",
  "can",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "how",
  "what",
  "when",
  "where",
  "why",
  "who",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "by",
  "and",
  "or",
  "but",
  "not",
  "no",
  "if",
  "so",
  "than",
  "that",
  "this",
]);

function tokenize(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
