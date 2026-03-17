/**
 * Normalize a phone number to a minimal canonical form.
 * Strips spaces, dashes, parens. Preserves leading +.
 * For full E.164, a library like libphonenumber is needed,
 * but this handles the 90% case for SEA numbers.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, "").toLowerCase();
}

/**
 * Normalize an email for identity matching.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
