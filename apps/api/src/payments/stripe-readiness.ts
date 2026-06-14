// Single source of truth for whether an org's `stripe` Connection resolves to the live
// StripeConnectPaymentAdapter or fails closed to Noop, and why. Both
// payment-port-factory.ts (resolveForOrg) and the readiness CLI call classifyStripeReadiness
// so the diagnostic can never drift from the factory's real decision. Pure: no I/O, never
// reads or returns the Stripe secret key.
import {
  parseStripeConnectCredentials,
  type StripeConnectCredentials,
} from "./stripe-connect-credentials.js";

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

// The CLI distinguishes a decrypt failure (wrong CREDENTIALS_ENCRYPTION_KEY / corrupt blob)
// from the five predicate reasons. credentials_unreadable is produced by the assembler
// before the predicate runs; it is not a predicate reason.
export type OrgReadinessReason = StripeReadinessReason | "credentials_unreadable";

export interface OrgReadinessResult extends Omit<StripeReadinessVerdict, "reason"> {
  reason: OrgReadinessReason;
}

export interface RawStripeConnectionRow {
  credentials: unknown;
  externalAccountId: string | null;
  status: string;
}

/** Human-readable, actionable one-liner. Never contains the secret. */
export function describeReadiness(result: OrgReadinessResult): string {
  switch (result.reason) {
    case "ready":
      return `LIVE - resolves to StripeConnectPaymentAdapter on ${result.connectedAccountId}`;
    case "no_connection":
      return "NOOP - no 'stripe' Connection for this org; run scripts/provision-stripe-for-org.mts";
    case "status_not_connected":
      return `NOOP - Connection.status is '${result.status}', not '${STRIPE_LIVE_CONNECTION_STATUS}'; re-provision or restore status`;
    case "credentials_incomplete":
      return "NOOP - stripe Connection credentials incomplete (need connectedAccountId and secretKey); re-provision";
    case "account_mismatch":
      return `NOOP - connectedAccountId ${result.connectedAccountId} does not equal externalAccountId ${result.externalAccountId}; settlement could not resolve this org; re-provision so they match`;
    case "credentials_unreadable":
      return "NOOP - stripe Connection credentials could not be decrypted (wrong CREDENTIALS_ENCRYPTION_KEY or corrupt blob); run with the API's encryption key";
  }
}

export interface RedirectPrecondition {
  ok: boolean;
  source: "PAYMENT_PUBLIC_URL" | "DASHBOARD_URL" | "fallback";
  // The configured origin (trailing slashes stripped), or null when it falls back to the
  // localhost dev default.
  effectiveBaseUrl: string | null;
}

/**
 * Mirror app.ts exactly: PAYMENT_PUBLIC_URL || DASHBOARD_URL || localhost dev default. The ||
 * is BARE (app.ts:525-528), so a whitespace-only value is truthy and shadows the next source;
 * the factory's trim-empty-guard then falls back to the localhost default. So a whitespace
 * PAYMENT_PUBLIC_URL resolves to localhost, NOT to DASHBOARD_URL, and this diagnostic reports
 * the localhost fallback rather than a false OK on a source app.ts never consulted. A fallback
 * to localhost means a live org would issue Checkout links pointing at localhost.
 */
export function resolveRedirectPrecondition(env: {
  PAYMENT_PUBLIC_URL?: string;
  DASHBOARD_URL?: string;
}): RedirectPrecondition {
  const paymentPublicChosen = Boolean(env.PAYMENT_PUBLIC_URL);
  const chosen = env.PAYMENT_PUBLIC_URL || env.DASHBOARD_URL || "";
  const effectiveBaseUrl = chosen.trim().replace(/\/+$/, "");
  if (!effectiveBaseUrl) {
    return { ok: false, source: "fallback", effectiveBaseUrl: null };
  }
  return {
    ok: true,
    source: paymentPublicChosen ? "PAYMENT_PUBLIC_URL" : "DASHBOARD_URL",
    effectiveBaseUrl,
  };
}

export interface WebhookPrecondition {
  ok: boolean;
  stripeSecretKeySet: boolean;
  connectWebhookSecretSet: boolean;
}

/**
 * The settlement webhook verifier needs both STRIPE_SECRET_KEY and
 * STRIPE_CONNECT_WEBHOOK_SECRET (app.ts); absent either, the payments webhook 503s and no
 * deposit settles. Reports presence booleans only, never the values.
 */
export function resolveWebhookPrecondition(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_CONNECT_WEBHOOK_SECRET?: string;
}): WebhookPrecondition {
  const stripeSecretKeySet = Boolean(env.STRIPE_SECRET_KEY);
  const connectWebhookSecretSet = Boolean(env.STRIPE_CONNECT_WEBHOOK_SECRET);
  return {
    ok: stripeSecretKeySet && connectWebhookSecretSet,
    stripeSecretKeySet,
    connectWebhookSecretSet,
  };
}

/**
 * Assemble the readiness result for one org from its raw stripe Connection row (or null).
 * Decryption is injected so this stays pure and testable. Mirrors the factory's precedence:
 * a non-connected row is never decrypted. A decrypt failure is reported as
 * credentials_unreadable rather than crashing. Never returns the secret.
 */
export function assembleOrgReadiness(
  row: RawStripeConnectionRow | null,
  decrypt: (encrypted: unknown) => Record<string, unknown>,
): OrgReadinessResult {
  if (!row) {
    return classifyStripeReadiness(null, null);
  }
  const view: StripeReadinessConnectionView = {
    status: row.status,
    externalAccountId: row.externalAccountId,
  };
  if (row.status !== STRIPE_LIVE_CONNECTION_STATUS) {
    // Never decrypt a non-connected row (mirrors the factory's status-filtered query).
    return classifyStripeReadiness(view, null);
  }
  let decrypted: Record<string, unknown>;
  try {
    decrypted = decrypt(row.credentials);
  } catch {
    return {
      live: false,
      reason: "credentials_unreadable",
      connectedAccountId: null,
      externalAccountId: row.externalAccountId,
      status: row.status,
    };
  }
  return classifyStripeReadiness(view, parseStripeConnectCredentials(decrypted));
}
