// ---------------------------------------------------------------------------
// Banned Phrase Filter — Content safety filter for outgoing messages
// ---------------------------------------------------------------------------

export interface BannedPhraseConfig {
  phrases: string[];
  patterns?: string[];
  replacement?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createBannedPhraseFilter(config: BannedPhraseConfig) {
  const replacement = config.replacement ?? "[redacted]";

  const compiledPatterns: RegExp[] = (config.patterns ?? []).map((p) => new RegExp(p, "gi"));

  return function filterText(text: string): string {
    let filtered = text;
    for (const phrase of config.phrases) {
      const regex = new RegExp(escapeRegex(phrase), "gi");
      filtered = filtered.replace(regex, replacement);
    }
    for (const pattern of compiledPatterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      filtered = filtered.replace(pattern, replacement);
    }
    return filtered;
  };
}
