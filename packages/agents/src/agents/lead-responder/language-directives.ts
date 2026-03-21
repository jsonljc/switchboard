// ---------------------------------------------------------------------------
// Language Directives — system prompt language instructions
// ---------------------------------------------------------------------------

export type SupportedLanguage = "en" | "ms" | "zh" | "en-sg";

export const LANGUAGE_DIRECTIVES: Record<SupportedLanguage, string> = {
  en: "Respond in English. Use clear, natural English appropriate for the chosen tone.",

  ms: "Respond in Malay (Bahasa Melayu). Use natural, conversational Malay. If the client writes in English, you may respond in the language they used.",

  zh: "Respond in Mandarin Chinese (简体中文). Use natural, conversational Mandarin. If the client writes in English, you may respond in the language they used.",

  "en-sg":
    "Respond in Singlish (Singapore English). Use natural Singlish expressions, particles (lah, leh, lor, meh), and local phrasing. Keep it authentic but understandable. If the client writes in formal English, match their register.",
};

const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export function getLanguageDirective(language: SupportedLanguage | undefined): string {
  if (!language) return LANGUAGE_DIRECTIVES[DEFAULT_LANGUAGE];
  return LANGUAGE_DIRECTIVES[language] ?? LANGUAGE_DIRECTIVES[DEFAULT_LANGUAGE];
}
