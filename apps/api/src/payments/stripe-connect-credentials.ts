export interface StripeConnectCredentials {
  connectedAccountId: string;
  secretKey: string;
  webhookSecret: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Fail-closed parse of an org's decrypted `stripe` Connection credentials into
 * the three fields a live Connect deposit write needs. Returns null unless ALL
 * three are present non-empty strings, so the factory can only ever build a
 * live-money adapter from complete credentials (spec: never a partial / global
 * fallback for a live write).
 */
export function parseStripeConnectCredentials(
  decrypted: Record<string, unknown>,
): StripeConnectCredentials | null {
  const { connectedAccountId, secretKey, webhookSecret } = decrypted;
  if (
    nonEmptyString(connectedAccountId) &&
    nonEmptyString(secretKey) &&
    nonEmptyString(webhookSecret)
  ) {
    return { connectedAccountId, secretKey, webhookSecret };
  }
  return null;
}
