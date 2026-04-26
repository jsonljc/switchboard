export class PhoneError extends Error {
  constructor(public readonly reason: "too_short" | "no_country_code" | "invalid") {
    super(`phone normalization failed: ${reason}`);
  }
}

export function normalizePhone(raw: string, defaultCountryCode: string | null): string {
  const stripped = raw.replace(/[\s()-]/g, "");
  const hasPlus = stripped.startsWith("+");
  const digitsOnly = stripped.replace(/^\+/, "");

  if (!/^[0-9]+$/.test(digitsOnly)) {
    throw new PhoneError("invalid");
  }
  if (digitsOnly.length < 7) {
    throw new PhoneError("too_short");
  }
  if (hasPlus) return "+" + digitsOnly;

  if (!defaultCountryCode) {
    throw new PhoneError("no_country_code");
  }
  const cc = defaultCountryCode.replace(/^\+/, "");
  return "+" + cc + digitsOnly;
}
