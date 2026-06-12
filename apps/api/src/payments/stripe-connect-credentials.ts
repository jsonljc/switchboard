export interface StripeConnectCredentials {
  connectedAccountId: string;
  secretKey: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Fail-closed parse of an org's decrypted `stripe` Connection credentials into the
 * two fields a live Connect deposit write needs: the connected account id money
 * routes to, and the secret key authorizing action on it. Returns null unless BOTH
 * are present non-empty strings, so the factory can only ever build a live-money
 * adapter from complete credentials (never a partial / global fallback for a live
 * write).
 *
 * RECONCILIATION (post-#984): the per-org `webhookSecret` is deliberately NOT part
 * of this contract. Connect webhooks are verified at the platform level with the
 * single STRIPE_CONNECT_WEBHOOK_SECRET (the `app.paymentWebhookVerifier` decorator
 * wired in app.ts), and the adapter never consumes a per-org webhook secret.
 * Requiring one here silently stranded a correctly provisioned org (secretKey +
 * connectedAccountId) on the Noop adapter. Any `webhookSecret` still stored on the
 * Connection is preserved by the credential store's read-modify-write merge; it is
 * simply ignored on this read path.
 */
export function parseStripeConnectCredentials(
  decrypted: Record<string, unknown>,
): StripeConnectCredentials | null {
  const { connectedAccountId, secretKey } = decrypted;
  if (nonEmptyString(connectedAccountId) && nonEmptyString(secretKey)) {
    return { connectedAccountId, secretKey };
  }
  return null;
}
