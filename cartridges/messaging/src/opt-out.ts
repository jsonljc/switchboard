// ---------------------------------------------------------------------------
// Opt-Out Handling — WhatsApp compliance keyword detection
// ---------------------------------------------------------------------------

export const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "cancel"];
export const OPT_IN_KEYWORDS = ["start"];

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

export function detectOptOut(message: string): boolean {
  const normalized = normalizeMessage(message);
  return OPT_OUT_KEYWORDS.includes(normalized);
}

export function detectOptIn(message: string): boolean {
  const normalized = normalizeMessage(message);
  return OPT_IN_KEYWORDS.includes(normalized);
}
