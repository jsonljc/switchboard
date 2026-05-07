// WhatsApp messaging opt-out keyword detection.
//
// Match the message text exactly (after trim + lowercase + whitespace collapse)
// against a small set of well-known opt-out keywords. Substring matches are
// intentionally NOT supported — "please stop by my place" must not opt the
// user out.

const OPT_OUT_KEYWORDS: ReadonlySet<string> = new Set(["stop", "unsubscribe", "opt out"]);

export function isOptOutKeyword(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length === 0) return false;
  return OPT_OUT_KEYWORDS.has(normalized);
}
