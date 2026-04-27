/**
 * Maps a provisioning result's `status` + `statusDetail` to a user-friendly,
 * sanitized message suitable for end-user display.
 *
 * Backend `statusDetail` may contain env-var names, tokens, or phoneNumberIds.
 * This module guarantees no such leakage reaches the rendered UI.
 *
 * Returns `null` only for `status === "active"` (success).
 */

export type ProvisionStatus =
  | "active"
  | "config_error"
  | "pending_chat_register"
  | "health_check_failed"
  | "pending_meta_register"
  | "error";

export interface ProvisionResultLike {
  status: ProvisionStatus | string;
  statusDetail: string | null;
}

const SAFE_FALLBACK = "Channel setup is not complete yet. Please review the connection status.";
const SAFE_ERROR_FALLBACK = "Channel setup didn't complete. Please contact support.";

const STATIC_MESSAGES: Record<Exclude<ProvisionStatus, "error">, string | null> = {
  active: null,
  config_error:
    "Channel setup can't complete because the platform is not fully configured. Please contact support.",
  pending_chat_register:
    "Connection registered with WhatsApp, but our message router didn't acknowledge yet. Please retry, or contact support if this persists.",
  pending_meta_register:
    "We saved your connection, but couldn't fully register the webhook with Meta. Please retry, or contact support if this persists.",
  health_check_failed:
    "We couldn't verify the WhatsApp credentials. Please double-check the access token and phone number ID.",
};

// Match all-caps env-var-shaped tokens (e.g. CHAT_PUBLIC_URL, INTERNAL_API_SECRET).
const ENV_VAR_RE = /[A-Z][A-Z0-9_]{4,}/;
// Match phoneNumberId-like long digit runs.
const LONG_DIGITS_RE = /\d{10,}/;
// Match long token-like base64-ish strings.
const TOKEN_LIKE_RE = /[A-Za-z0-9_-]{32,}/;

function isSafeForUser(detail: string): boolean {
  if (ENV_VAR_RE.test(detail)) return false;
  if (LONG_DIGITS_RE.test(detail)) return false;
  if (TOKEN_LIKE_RE.test(detail)) return false;
  return true;
}

export function provisionStatusMessage(result: ProvisionResultLike): string | null {
  if (result.status === "active") return null;

  if (result.status === "error") {
    const detail = result.statusDetail ?? "";
    if (detail.length > 0 && isSafeForUser(detail)) {
      return detail;
    }
    return SAFE_ERROR_FALLBACK;
  }

  const known = STATIC_MESSAGES[result.status as Exclude<ProvisionStatus, "error">];
  if (known !== undefined) return known;

  return SAFE_FALLBACK;
}
