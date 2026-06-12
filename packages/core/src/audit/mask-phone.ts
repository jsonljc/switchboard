// ---------------------------------------------------------------------------
// maskPhone — last-4 phone redaction for logs and display
// ---------------------------------------------------------------------------
// Patient phone numbers must never reach log sinks in full (PDPA; audit F10).
// This masks any phone-like value to its last 4 digits, e.g. "+65 9123 4567"
// becomes "…4567". Non-digits are stripped first so SG/MY international formats
// work. Pure and surface-agnostic — safe to use in core, db and apps.
// ---------------------------------------------------------------------------

/** Returned when a value has fewer than 4 digits — never the raw value. */
export const PHONE_MASK_FALLBACK = "…";

/**
 * Mask a phone-like value to its last 4 digits for safe logging/display.
 *
 * @param value any string that may contain a phone number
 * @returns `…1234` when at least 4 digits are present, otherwise
 *   {@link PHONE_MASK_FALLBACK}.
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return PHONE_MASK_FALLBACK;
  return `…${digits.slice(-4)}`;
}
