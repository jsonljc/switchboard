/**
 * ConversationNLPAdapter — sits between the router and conversation engine
 * to enable free-text interpretation for question steps.
 *
 * For question steps with `llmPersonalization: true`, uses NLP to interpret
 * free-text responses as option selections. Falls back to numbered-option parsing.
 */

import type { FlowStep } from "./types.js";
import { MessageIntentClassifier } from "./intent-classifier.js";
import type { ClassificationResult } from "./intent-classifier.js";

export interface NLPAdapterResult {
  /** Resolved option index (1-based), or null if not an option selection */
  resolvedOptionIndex: number | null;
  /** The intent classification */
  classification: ClassificationResult;
  /** Whether NLP was used (vs. simple numeric match) */
  nlpUsed: boolean;
  /** Extracted variables to set on conversation state */
  extractedVariables: Record<string, unknown>;
}

/**
 * Affirmative/negative word → option mapping for yes/no questions.
 */
const YES_NO_MAP: Record<string, number> = {
  yes: 1, yeah: 1, yep: 1, yup: 1, sure: 1, ok: 1, okay: 1,
  absolutely: 1, definitely: 1,
  no: 2, nope: 2, nah: 2, pass: 2,
};

export class ConversationNLPAdapter {
  private classifier: MessageIntentClassifier;

  constructor() {
    this.classifier = new MessageIntentClassifier();
  }

  /**
   * Process a user message in the context of the current conversation step.
   * Returns a resolved option index or extracted variables.
   */
  processMessage(
    message: string,
    currentStep: FlowStep | null,
  ): NLPAdapterResult {
    const trimmed = message.trim();
    const classification = this.classifier.classify(trimmed);

    // If it's a numeric option, return directly
    if (classification.intent === "option_selection" && classification.selectedOption) {
      return {
        resolvedOptionIndex: classification.selectedOption,
        classification,
        nlpUsed: false,
        extractedVariables: { selectedOption: classification.selectedOption },
      };
    }

    // If no current step or not a question, return classification only
    if (!currentStep || currentStep.type !== "question") {
      return {
        resolvedOptionIndex: null,
        classification,
        nlpUsed: true,
        extractedVariables: classification.extractedData ?? {},
      };
    }

    const options = currentStep.options ?? [];

    // Try to map affirmative/negative to yes/no questions
    if (options.length === 2) {
      const yesNoIndex = YES_NO_MAP[trimmed.toLowerCase()];
      if (yesNoIndex && yesNoIndex <= options.length) {
        return {
          resolvedOptionIndex: yesNoIndex,
          classification: { ...classification, intent: "option_selection" },
          nlpUsed: true,
          extractedVariables: { selectedOption: yesNoIndex },
        };
      }
    }

    // Try fuzzy matching against options
    const fuzzyMatch = this.fuzzyMatchOption(trimmed, options);
    if (fuzzyMatch) {
      return {
        resolvedOptionIndex: fuzzyMatch,
        classification: { ...classification, intent: "option_selection" },
        nlpUsed: true,
        extractedVariables: { selectedOption: fuzzyMatch },
      };
    }

    // Extract variables from freeform response
    const extractedVariables: Record<string, unknown> = {
      ...classification.extractedData,
      lastMessage: trimmed,
      lastMessageLower: trimmed.toLowerCase(),
    };

    // For escalation requests, set escalation flag
    if (classification.intent === "escalation_request") {
      extractedVariables["escalationRequested"] = true;
    }

    return {
      resolvedOptionIndex: null,
      classification,
      nlpUsed: true,
      extractedVariables,
    };
  }

  /**
   * Fuzzy-match user text against option labels.
   * Returns 1-based index, or null if no match.
   */
  private fuzzyMatchOption(text: string, options: string[]): number | null {
    const lower = text.toLowerCase();

    for (let i = 0; i < options.length; i++) {
      const option = options[i]!.toLowerCase();

      // Exact match
      if (lower === option) return i + 1;

      // Option starts with user text or vice versa
      if (option.startsWith(lower) || lower.startsWith(option)) return i + 1;

      // User text contains the key words from the option
      const optionWords = option.split(/\s+/).filter((w) => w.length > 3);
      if (optionWords.length > 0) {
        const matchCount = optionWords.filter((w) => lower.includes(w)).length;
        if (matchCount >= Math.ceil(optionWords.length * 0.6)) return i + 1;
      }
    }

    return null;
  }
}
