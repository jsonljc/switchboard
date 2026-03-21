// ---------------------------------------------------------------------------
// Post-Generation Validator — validates LLM output before sending
// ---------------------------------------------------------------------------

import type { PrimaryMove } from "./types.js";

export type ViolationSeverity = "warn" | "block" | "escalate";

export interface Violation {
  rule: string;
  severity: ViolationSeverity;
  match?: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
  fallbackMessage?: string;
}

export interface PostValidatorConfig {
  forbiddenPhrases?: string[];
  bannedTopics?: string[];
}

/** Fallback messages per PrimaryMove when a response is blocked. */
const FALLBACK_MESSAGES: Partial<Record<PrimaryMove, string>> = {
  greet: "Hey! What can we help you with today?",
  acknowledge_and_hold: "Got it, thanks for letting us know. Give me a moment to check on that.",
  answer_question: "Good question! Let me get someone who knows more about this to help you out.",
  ask_qualification_question: "To point you in the right direction — what are you looking for?",
  handle_objection: "That makes sense. Let me share a few things that might help with that.",
  advance_to_booking: "Want to lock in a slot that works for you?",
  escalate_to_human: "Let me get one of our team to help you directly.",
  clarify: "Got it — could you share a bit more so I can help?",
};

const DEFAULT_FALLBACK = "Thanks for your message. How can I help you?";

/** Platform-hardcoded rules (cannot be removed). */
const HARDCODED_RULES: Array<{ pattern: RegExp; rule: string; severity: ViolationSeverity }> = [
  {
    pattern: /\b(guaranteed?\s+(results?|cure|fix|heal))\b/i,
    rule: "medical_guarantee_claim",
    severity: "block",
  },
  {
    pattern: /\b(\d+\s*mg|\d+\s*ml|dosage|dose|prescription)\b/i,
    rule: "dosage_mention",
    severity: "block",
  },
  {
    pattern: /\b(diagnos(e|is|ed)|you have|you suffer from|condition is)\b/i,
    rule: "diagnosis_claim",
    severity: "escalate",
  },
  {
    pattern: /\b(permanent(ly)?|forever|100%|never\s+(come back|return|recur))\b/i,
    rule: "permanence_claim",
    severity: "block",
  },
  { pattern: /\u2014/, rule: "em_dash_usage", severity: "warn" },
  {
    pattern: /\?[^?]*\?/,
    rule: "multiple_questions",
    severity: "warn",
  },
  {
    pattern: /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F){3,}/u,
    rule: "excessive_emoji",
    severity: "warn",
  },
];

export class PostGenerationValidator {
  private config: PostValidatorConfig;

  constructor(config?: PostValidatorConfig) {
    this.config = config ?? {};
  }

  validate(text: string, primaryMove: PrimaryMove, maxWords?: number): ValidationResult {
    const violations: Violation[] = [];

    // Hardcoded platform rules
    for (const rule of HARDCODED_RULES) {
      const match = text.match(rule.pattern);
      if (match) {
        violations.push({
          rule: rule.rule,
          severity: rule.severity,
          match: match[0],
        });
      }
    }

    // Length check
    if (maxWords) {
      const wordCount = text.split(/\s+/).length;
      if (wordCount > maxWords * 1.5) {
        violations.push({ rule: "excessive_length", severity: "warn" });
      }
    }

    // Forbidden phrases (configurable)
    for (const phrase of this.config.forbiddenPhrases ?? []) {
      if (text.toLowerCase().includes(phrase.toLowerCase())) {
        violations.push({
          rule: "forbidden_phrase",
          severity: "warn",
          match: phrase,
        });
      }
    }

    // Banned topics (configurable)
    for (const topic of this.config.bannedTopics ?? []) {
      if (text.toLowerCase().includes(topic.toLowerCase())) {
        violations.push({
          rule: "banned_topic",
          severity: "block",
          match: topic,
        });
      }
    }

    const hasBlockOrEscalate = violations.some(
      (v) => v.severity === "block" || v.severity === "escalate",
    );

    return {
      valid: !hasBlockOrEscalate,
      violations,
      fallbackMessage: hasBlockOrEscalate
        ? (FALLBACK_MESSAGES[primaryMove] ?? DEFAULT_FALLBACK)
        : undefined,
    };
  }
}
