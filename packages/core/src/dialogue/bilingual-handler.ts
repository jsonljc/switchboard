// ---------------------------------------------------------------------------
// Bilingual Handler — language resolution and content selection
// ---------------------------------------------------------------------------

import type { DetectedLanguage } from "./language-detector.js";
import { detectLanguage } from "./language-detector.js";

export interface BilingualConfig {
  languages: string[];
  defaultLanguage?: string;
}

export interface BilingualContent {
  en?: string;
  zh?: string;
  ms?: string;
}

/** Resolve the user's preferred language from message history. */
export function resolveLanguage(
  messages: Array<{ role: string; text: string }>,
  config: BilingualConfig,
): DetectedLanguage {
  // Analyze the last 3 user messages
  const userMessages = messages.filter((m) => m.role === "user").slice(-3);

  if (userMessages.length === 0) {
    return (config.defaultLanguage as DetectedLanguage) ?? "en";
  }

  const detections = userMessages.map((m) => detectLanguage(m.text));

  // Use majority language from recent messages
  const counts: Record<DetectedLanguage, number> = { en: 0, zh: 0, ms: 0, mixed: 0 };
  for (const d of detections) {
    counts[d.detected]++;
  }

  let bestLang: DetectedLanguage = "en";
  let bestCount = 0;
  for (const [lang, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      bestLang = lang as DetectedLanguage;
    }
  }

  // Only return a non-English language if it's in the configured languages
  if (bestLang !== "en" && !config.languages.includes(bestLang)) {
    return "en";
  }

  return bestLang;
}

/** Get content in the preferred language, falling back to English. */
export function getLocalizedContent(content: BilingualContent, language: DetectedLanguage): string {
  if (language === "zh" && content.zh) return content.zh;
  if (language === "ms" && content.ms) return content.ms;
  return content.en ?? "";
}

/** Check if translation is missing for a language and return the gap. */
export function findMissingTranslation(
  contentId: string,
  content: BilingualContent,
  language: DetectedLanguage,
): string | null {
  if (language === "zh" && !content.zh) return `Missing ZH translation for: ${contentId}`;
  if (language === "ms" && !content.ms) return `Missing MS translation for: ${contentId}`;
  return null;
}
