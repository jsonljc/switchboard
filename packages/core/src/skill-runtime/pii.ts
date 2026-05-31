/** Prompt-safe projection of a contact. Allow-list ONLY: any field not named
 * here (phone, email, id, …) is dropped, so a new PII column can never silently
 * reach the model. The customer's name is intentionally retained for natural
 * conversation; phone/email/contactId are never prompt- or model-visible. */
export interface PromptSafeContact {
  name?: string | null;
  stage?: string | null;
  source?: string | null;
}

const asStringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function sanitizeContactForPrompt(contact: unknown): PromptSafeContact | null {
  if (contact === null || typeof contact !== "object") return null;
  const c = contact as Record<string, unknown>;
  // Type-safe allow-list: only string values survive; anything else (object,
  // number, undefined) coerces to null so an unexpected shape can't pass through
  // as name/stage/source.
  return {
    name: asStringOrNull(c["name"]),
    stage: asStringOrNull(c["stage"]),
    source: asStringOrNull(c["source"]),
  };
}
