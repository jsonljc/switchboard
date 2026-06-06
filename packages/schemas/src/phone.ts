/** Canonical E.164 phone helpers. Layer-1 (no @switchboard/* imports). */

/** Same pattern as whatsapp-template-create.ts:3 — E.164: + then 7..15 digits, first digit 1-9. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** True when `value` is already a valid E.164 string. */
export function isE164(value: string): boolean {
  return E164.test(value);
}

/** SG mobile (and 8/9-prefixed) local number: exactly 8 digits starting 8 or 9. */
const SG_8_DIGIT = /^[89]\d{7}$/;
/** MY national number written with a trunk 0 prefix, e.g. 0123456789. */
const MY_TRUNK_ZERO = /^0\d{8,10}$/;

/**
 * Normalize a raw phone string to E.164, or return null when it cannot be
 * normalized WITHOUT guessing a country (a wrong merge is worse than no merge).
 *
 * - Already-`+` numbers are validated and returned (spaces/dashes/parens stripped).
 * - An SG 8-digit mobile ([89]xxxxxxx) maps to +65 when `region` is 'SG' or
 *   undefined (SG is the pilot default for THIS shape only).
 * - A 0-prefixed national number maps to +60 ONLY when `region` is explicitly 'MY'.
 * - Anything else (ambiguous, 0-prefixed without a region, junk) → null.
 *
 * Never throws.
 */
export function normalizeToE164(
  raw: string | null | undefined,
  region?: "SG" | "MY",
): string | null {
  if (!raw) return null;
  // Strip spaces, dashes, and parentheses; keep a leading + and digits.
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (cleaned === "") return null;

  if (cleaned.startsWith("+")) {
    return E164.test(cleaned) ? cleaned : null;
  }

  // MY trunk-zero national number: only with an explicit MY region signal.
  if (region === "MY" && MY_TRUNK_ZERO.test(cleaned)) {
    const candidate = `+60${cleaned.slice(1)}`;
    return E164.test(candidate) ? candidate : null;
  }

  // SG 8-digit mobile: pilot default for this shape when region is SG or absent.
  if ((region === "SG" || region === undefined) && SG_8_DIGIT.test(cleaned)) {
    const candidate = `+65${cleaned}`;
    return E164.test(candidate) ? candidate : null;
  }

  // Refuse to guess.
  return null;
}
