// ---------------------------------------------------------------------------
// Language Detector — Unicode range analysis (no LLM dependency)
// ---------------------------------------------------------------------------

export type DetectedLanguage = "en" | "zh" | "ms" | "mixed";

export interface LanguageDetectionResult {
  detected: DetectedLanguage;
  confidence: number;
}

/** CJK Unified Ideographs range. */
const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
/** Latin character range (basic + extended). */
const LATIN_RANGE = /[a-zA-Z\u00C0-\u024F]/g;
/** Malay-specific common words. */
const MALAY_WORDS =
  /\b(saya|anda|ini|itu|ada|tidak|boleh|nak|mau|bagus|baik|terima kasih|berapa|macam)\b/gi;

export function detectLanguage(text: string): LanguageDetectionResult {
  const cleanText = text.replace(/\s+/g, "");
  if (cleanText.length === 0) {
    return { detected: "en", confidence: 0 };
  }

  const cjkMatches = text.match(CJK_RANGE) ?? [];
  const latinMatches = text.match(LATIN_RANGE) ?? [];
  const malayMatches = text.match(MALAY_WORDS) ?? [];

  const cjkRatio = cjkMatches.length / cleanText.length;
  const latinRatio = latinMatches.length / cleanText.length;

  // Primarily CJK
  if (cjkRatio > 0.5) {
    return { detected: "zh", confidence: Math.min(cjkRatio + 0.2, 1.0) };
  }

  // Mixed CJK and Latin
  if (cjkRatio > 0.1 && latinRatio > 0.1) {
    return { detected: "mixed", confidence: 0.7 };
  }

  // Check for Malay
  if (malayMatches.length >= 2) {
    return { detected: "ms", confidence: Math.min(0.5 + malayMatches.length * 0.1, 0.9) };
  }

  // Default to English
  return { detected: "en", confidence: latinRatio > 0.5 ? 0.9 : 0.6 };
}
