export function buildLanguageInstruction(
  detectedLanguage: string | null,
  availableLanguages: string[],
): string {
  if (detectedLanguage) {
    return `\nContinue this conversation in ${detectedLanguage}. If the customer switches language, follow their switch.`;
  }

  if (availableLanguages.length > 0) {
    return `\nYou may communicate in: ${availableLanguages.join(", ")}. Match the customer's language. If unsure, use English.`;
  }

  return "";
}
