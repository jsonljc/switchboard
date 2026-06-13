// Single source of truth for whether an org's `stripe` Connection resolves to the live
// StripeConnectPaymentAdapter or fails closed to Noop, and why. Both
// payment-port-factory.ts (resolveForOrg) and the readiness CLI call classifyStripeReadiness
// so the diagnostic can never drift from the factory's real decision. Pure: no I/O, never
// reads or returns the Stripe secret key.
import { type StripeConnectCredentials } from "./stripe-connect-credentials.js";

/**
 * The Connection.status value a live Stripe deposit Connection must have. The factory query
 * filters on this and the predicate gates on it, so the value is defined exactly once.
 */
export const STRIPE_LIVE_CONNECTION_STATUS = "connected";

export type StripeReadinessReason =
  | "ready"
  | "no_connection"
  | "status_not_connected"
  | "credentials_incomplete"
  | "account_mismatch";

export interface StripeReadinessConnectionView {
  status: string;
  externalAccountId: string | null;
}

export interface StripeReadinessVerdict {
  live: boolean;
  reason: StripeReadinessReason;
  // acct_... identifiers only, for display; the secret key is never carried here.
  connectedAccountId: string | null;
  externalAccountId: string | null;
  status: string | null;
}

/**
 * Classify an org's stripe Connection. `credentials` is the parsed #999 result
 * (parseStripeConnectCredentials), so the completeness contract stays single-sourced and the
 * secret never enters the decision. Gate order mirrors the factory's real precedence.
 */
export function classifyStripeReadiness(
  connection: StripeReadinessConnectionView | null,
  credentials: StripeConnectCredentials | null,
): StripeReadinessVerdict {
  const connectedAccountId = credentials?.connectedAccountId ?? null;
  const externalAccountId = connection?.externalAccountId ?? null;
  const status = connection?.status ?? null;
  const base = { connectedAccountId, externalAccountId, status };

  if (!connection) {
    return { live: false, reason: "no_connection", ...base };
  }
  if (connection.status !== STRIPE_LIVE_CONNECTION_STATUS) {
    return { live: false, reason: "status_not_connected", ...base };
  }
  if (!credentials) {
    return { live: false, reason: "credentials_incomplete", ...base };
  }
  if (credentials.connectedAccountId !== connection.externalAccountId) {
    return { live: false, reason: "account_mismatch", ...base };
  }
  return { live: true, reason: "ready", ...base };
}
