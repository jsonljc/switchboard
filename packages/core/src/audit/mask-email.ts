// ---------------------------------------------------------------------------
// maskEmail: local-part redaction for logs and display
// ---------------------------------------------------------------------------
// Approver email addresses must never reach log sinks in full (PDPA; audit F10).
// This masks the local part of an email address while preserving the domain for
// delivery-debug purposes, e.g. "jason@live.com" becomes "j…@live.com".
// Pure and surface-agnostic; safe to use in core, db and apps.
// ---------------------------------------------------------------------------

/** Returned when a value does not look like a valid email; never the raw value. */
export const EMAIL_MASK_FALLBACK = "…";

/**
 * Mask an email address's local part for safe logging/display.
 *
 * Keeps the first character of the local part (when length > 1) and the full
 * domain so delivery failures remain debuggable.
 *
 * @param value any string that may contain an email address
 * @returns `j…@example.com` when a valid-looking address is present, otherwise
 *   {@link EMAIL_MASK_FALLBACK}.
 */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return EMAIL_MASK_FALLBACK;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return local.length <= 1 ? `…@${domain}` : `${local[0]}…@${domain}`;
}
