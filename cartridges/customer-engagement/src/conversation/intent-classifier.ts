/**
 * MessageIntentClassifier — classifies contact messages into semantic categories.
 *
 * Uses deterministic regex patterns first, with optional LLM fallback.
 * This enables free-text understanding in conversation flows.
 */

export type MessageIntent =
  | "option_selection"
  | "freeform_answer"
  | "question"
  | "objection"
  | "escalation_request"
  | "off_topic"
  | "affirmative"
  | "negative";

export interface ClassificationResult {
  intent: MessageIntent;
  confidence: number;
  /** For option_selection: which option index was selected (1-based) */
  selectedOption?: number;
  /** Extracted data from freeform answers */
  extractedData?: Record<string, unknown>;
}

/** Regex patterns for deterministic classification */
const INTENT_PATTERNS: Array<{
  intent: MessageIntent;
  patterns: RegExp[];
  extract?: (text: string, match: RegExpMatchArray) => Partial<ClassificationResult>;
}> = [
  {
    intent: "option_selection",
    patterns: [/^(\d+)$/],
    extract: (_text, match) => ({ selectedOption: parseInt(match[1]!, 10) }),
  },
  {
    intent: "affirmative",
    patterns: [
      /^(?:yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|of course|sounds good|let'?s do it|go ahead|please)\.?$/i,
    ],
  },
  {
    intent: "negative",
    patterns: [
      /^(?:no|nope|nah|not? (?:interested|now|yet|thanks?)|maybe later|pass|skip|cancel)\.?$/i,
    ],
  },
  {
    intent: "escalation_request",
    patterns: [
      /(?:speak|talk|connect)\s+(?:to|with)\s+(?:a|an)?\s*(?:human|person|agent|someone|staff|doctor|manager)/i,
      /^(?:help|agent|human|real person|operator)$/i,
      /(?:i\s+(?:want|need)\s+(?:a\s+)?(?:real|human|actual)\s+person)/i,
    ],
  },
  {
    intent: "objection",
    patterns: [
      /(?:too expensive|can't afford|not sure|worried|scared|nervous|afraid|concerned|don'?t (?:think|want|need|know))/i,
      /(?:what if|but what|how (?:much|long|painful))/i,
      /(?:side effects|risks?|complications?|recovery|downtime)/i,
    ],
  },
  {
    intent: "question",
    patterns: [
      /^(?:what|when|where|how|why|who|which|is|are|can|do|does|will|would|could|should)\b/i,
      /\?$/,
    ],
  },
  {
    intent: "freeform_answer",
    patterns: [
      // Date/time patterns
      /(?:tomorrow|today|next\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /(?:\d{1,2}[:/]\d{2}|\d{1,2}\s*(?:am|pm))/i,
      // Name patterns
      /^(?:my name is|i'?m|call me)\s+(\w+)/i,
      // Email
      /[\w.-]+@[\w.-]+\.\w+/i,
      // Phone
      /(?:\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    ],
    extract: (text) => {
      const extracted: Record<string, unknown> = {};

      // Extract email
      const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (emailMatch) extracted["email"] = emailMatch[0];

      // Extract phone
      const phoneMatch = text.match(/(?:\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) extracted["phone"] = phoneMatch[0];

      // Extract name
      const nameMatch = text.match(/^(?:my name is|i'?m|call me)\s+(\w+)/i);
      if (nameMatch) extracted["name"] = nameMatch[1];

      return { extractedData: Object.keys(extracted).length > 0 ? extracted : undefined };
    },
  },
];

export class MessageIntentClassifier {
  /**
   * Classify a contact message into an intent category.
   * Uses deterministic regex patterns — no LLM dependency.
   */
  classify(text: string): ClassificationResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { intent: "off_topic", confidence: 0 };
    }

    for (const { intent, patterns, extract } of INTENT_PATTERNS) {
      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const extras = extract?.(trimmed, match) ?? {};
          return {
            intent,
            confidence: 0.85,
            ...extras,
          };
        }
      }
    }

    // Default: treat as freeform answer if it's short, off_topic if long
    if (trimmed.length < 100) {
      return { intent: "freeform_answer", confidence: 0.5 };
    }

    return { intent: "off_topic", confidence: 0.3 };
  }
}
