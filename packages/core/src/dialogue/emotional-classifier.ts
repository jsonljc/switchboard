// ---------------------------------------------------------------------------
// Emotional Signal Classifier — regex-based heuristics (LLM-optional)
// ---------------------------------------------------------------------------

import type { EmotionalSignal, EmotionalSignalInput } from "./types.js";

/** Singlish/MY marker particles and patterns. */
const SINGLISH_PARTICLES = /\b(lah|leh|lor|meh|hor|sia|ah|arh|anot|can lah|how ah)\b/i;
const MALAY_MIX = /\b(boleh|berapa|apa|macam mana|tak|ya|baik)\b/i;
const MANDARIN_MIX = /[\u4e00-\u9fff]/;

/** Concern type patterns. */
const PRICE_PATTERNS =
  /\b(price|cost|expensive|cheap|afford|budget|money|how much|berapa|pay|fee|discount|promo)\b/i;
const TRUST_PATTERNS =
  /\b(trust|legit|scam|fake|real|review|testimonial|reputation|safe|reliable)\b/i;
const TIMING_PATTERNS =
  /\b(busy|later|next time|not now|schedule|when|how long|wait|soon|urgent)\b/i;
const FEAR_PATTERNS = /\b(pain|hurt|scary|afraid|nervous|anxious|worried|fear|risk)\b/i;
const COMPARISON_PATTERNS = /\b(other|competitor|alternative|compare|better|cheaper|elsewhere)\b/i;

/** Urgency signal patterns. */
const READY_NOW = /\b(now|today|asap|immediately|right away|urgent|ready|book now)\b/i;
const EXPLORING = /\b(just asking|browsing|curious|exploring|not sure|maybe|thinking)\b/i;

/** Negative sentiment patterns. */
const NEGATIVE_PATTERNS =
  /\b(bad|terrible|awful|horrible|worst|hate|angry|frustrated|annoyed|unhappy|disappointed)\b/i;
const POSITIVE_PATTERNS =
  /\b(great|wonderful|excellent|amazing|perfect|love|happy|excited|thank|thanks)\b/i;

export function classifyEmotionalSignal(input: EmotionalSignalInput): EmotionalSignal {
  const { message, recentMessages } = input;
  const lower = message.toLowerCase().trim();

  // Valence detection
  let valence: EmotionalSignal["valence"] = "neutral";
  if (POSITIVE_PATTERNS.test(lower)) valence = "positive";
  if (NEGATIVE_PATTERNS.test(lower)) valence = "negative";

  // Engagement detection
  let engagement: EmotionalSignal["engagement"] = "medium";
  if (lower.length > 100) engagement = "high";
  if (lower.length < 10) engagement = "low";
  if (recentMessages && recentMessages.length >= 3) {
    const userMessages = recentMessages.filter((m) => m.role === "user");
    if (userMessages.length >= 2) {
      const prevLen = userMessages[userMessages.length - 2]?.text.length ?? 0;
      if (lower.length < prevLen * 0.5 && lower.length < 20) {
        engagement = "declining";
      }
    }
  }

  // Intent clarity
  let intentClarity: EmotionalSignal["intentClarity"] = "clear";
  if (lower.length < 5 || /^(ok|yes|no|hi|hello|hey|hmm|huh|idk)$/i.test(lower)) {
    intentClarity = "vague";
  }
  if (/\?.*\?/.test(lower) || /\b(confused|don'?t understand|what do you mean)\b/i.test(lower)) {
    intentClarity = "confused";
  }

  // Concern type
  let concernType: EmotionalSignal["concernType"] = "none";
  if (PRICE_PATTERNS.test(lower)) concernType = "price";
  else if (TRUST_PATTERNS.test(lower)) concernType = "trust";
  else if (TIMING_PATTERNS.test(lower)) concernType = "timing";
  else if (FEAR_PATTERNS.test(lower)) concernType = "fear";
  else if (COMPARISON_PATTERNS.test(lower)) concernType = "comparison";

  // Urgency signal
  let urgencySignal: EmotionalSignal["urgencySignal"] = "none";
  if (READY_NOW.test(lower)) urgencySignal = "ready_now";
  else if (EXPLORING.test(lower)) urgencySignal = "exploring";
  else if (TIMING_PATTERNS.test(lower)) urgencySignal = "soon";

  // Local marker detection
  let localMarker: EmotionalSignal["localMarker"] = "none";
  if (SINGLISH_PARTICLES.test(lower)) localMarker = "singlish";
  else if (MALAY_MIX.test(lower)) localMarker = "malay_mix";
  else if (MANDARIN_MIX.test(message)) localMarker = "mandarin_mix";

  // Confidence based on how many signals we detected
  const detectedSignals = [
    concernType !== "none",
    urgencySignal !== "none",
    localMarker !== "none",
    valence !== "neutral",
  ].filter(Boolean).length;
  const confidence = Math.min(0.5 + detectedSignals * 0.15, 1.0);

  return {
    valence,
    engagement,
    intentClarity,
    concernType,
    urgencySignal,
    localMarker,
    confidence,
  };
}
