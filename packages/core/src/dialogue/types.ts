// ---------------------------------------------------------------------------
// Dialogue Types — Emotional signals, naturalness packets, primary moves
// ---------------------------------------------------------------------------

/** The primary conversational move the agent should make. */
export type PrimaryMove =
  | "acknowledge_and_hold"
  | "answer_question"
  | "ask_qualification_question"
  | "handle_objection"
  | "advance_to_booking"
  | "confirm_booking"
  | "send_reminder"
  | "reactivate"
  | "escalate_to_human"
  | "greet"
  | "clarify"
  | "close";

/** Emotional signal detected from user message. */
export interface EmotionalSignal {
  valence: "positive" | "neutral" | "negative";
  engagement: "high" | "medium" | "low" | "declining";
  intentClarity: "clear" | "vague" | "confused";
  concernType: "price" | "trust" | "timing" | "fear" | "comparison" | "none";
  urgencySignal: "ready_now" | "soon" | "exploring" | "none";
  localMarker: "singlish" | "malay_mix" | "mandarin_mix" | "formal_english" | "none";
  confidence: number;
}

/** Input for emotional signal classification. */
export interface EmotionalSignalInput {
  message: string;
  recentMessages?: Array<{ role: string; text: string }>;
  channel?: string;
}

/** Voice configuration for response generation. */
export interface VoiceConfig {
  naturalness: "formal" | "semi_formal" | "casual";
  market: "SG" | "MY" | "US" | "UK" | "AU" | "generic";
  emojiPolicy: {
    allowed: boolean;
    maxPerMessage: number;
    preferredSet: string[];
  };
}

/** Constraints applied to the generated response. */
export interface ResponseConstraints {
  maxSentences: number;
  maxWords: number;
  forbiddenPhrases: string[];
  bannedTopics: string[];
  singleQuestionOnly: boolean;
  singleCTAOnly: boolean;
  noEmDashes: boolean;
}

/** Variation control to prevent repetitive responses. */
export interface VariationControl {
  openingStyle: "direct" | "empathetic" | "curious" | "light";
  recentlyUsedPhrases: string[];
  avoidPatterns: string[];
}

/** The complete packet given to the LLM for response generation. */
export interface NaturalnessPacket {
  primaryMove: PrimaryMove;
  approvedContent: string;
  voice: VoiceConfig;
  constraints: ResponseConstraints;
  leadContext: {
    name?: string;
    serviceInterest?: string;
    qualificationStage?: string;
    previousTurnCount: number;
  };
  variation: VariationControl;
}
