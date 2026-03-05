// ---------------------------------------------------------------------------
// HIPAA Redactor — beforeEnrich interceptor
// ---------------------------------------------------------------------------
// Strips PHI (Protected Health Information) from parameters before
// enrichment to prevent PII leakage to external services.
// ---------------------------------------------------------------------------

import type { CartridgeInterceptor, CartridgeContext } from "@switchboard/cartridge-sdk";

/** Patterns that match common PHI fields */
const PHI_FIELD_PATTERNS = [
  /ssn/i,
  /social.?security/i,
  /date.?of.?birth/i,
  /dob/i,
  /insurance.?id/i,
  /insurance.?number/i,
  /policy.?number/i,
  /medical.?condition/i,
  /diagnosis/i,
  /medication/i,
  /prescription/i,
  /allergy/i,
  /blood.?type/i,
  /lab.?result/i,
];

/** Patterns that match PHI values in string fields */
const PHI_VALUE_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{9}\b/, // SSN without dashes
];

export class HIPAARedactor implements CartridgeInterceptor {
  async beforeEnrich(
    _actionType: string,
    parameters: Record<string, unknown>,
    _context: CartridgeContext,
  ): Promise<{ parameters: Record<string, unknown> }> {
    const redacted = redactPHI(parameters);
    return { parameters: redacted };
  }
}

function redactPHI(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if key matches PHI field patterns
    if (PHI_FIELD_PATTERNS.some((p) => p.test(key))) {
      result[key] = "[REDACTED]";
      continue;
    }

    // Recursively handle nested objects
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactPHI(value as Record<string, unknown>);
      continue;
    }

    // Check string values for PHI patterns
    if (typeof value === "string") {
      let redactedValue = value;
      for (const pattern of PHI_VALUE_PATTERNS) {
        redactedValue = redactedValue.replace(pattern, "[REDACTED]");
      }
      result[key] = redactedValue;
      continue;
    }

    result[key] = value;
  }

  return result;
}
