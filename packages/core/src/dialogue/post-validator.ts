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
  greet: "Hi! Thanks for reaching out. How can I help you today?",
  acknowledge_and_hold: "Thanks for sharing that. Let me look into this for you.",
  answer_question:
    "That's a great question. Let me connect you with someone who can give you the best answer.",
  ask_qualification_question:
    "I'd love to help you find the right option. What are you looking for?",
  handle_objection:
    "I completely understand your concern. Let me share some information that might help.",
  advance_to_booking: "Would you like to schedule a time that works for you?",
  escalate_to_human: "Let me connect you with a team member who can help.",
  clarify: "Could you tell me a bit more about what you're looking for?",
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
