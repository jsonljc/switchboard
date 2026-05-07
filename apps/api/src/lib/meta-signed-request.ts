import { createHmac, timingSafeEqual } from "node:crypto";

// Meta App-level signed_request payload — Meta only guarantees a few fields
// across product surfaces (user_id, algorithm, issued_at). We model just what
// the Data Deletion callback needs and leave the rest as unknown extras.
export interface MetaSignedRequestPayload {
  user_id: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

export type SignedRequestVerifyFailure =
  | "empty_input"
  | "empty_secret"
  | "malformed"
  | "invalid_signature"
  | "invalid_payload_json"
  | "missing_user_id";

export type SignedRequestResult =
  | { ok: true; payload: MetaSignedRequestPayload }
  | { ok: false; reason: SignedRequestVerifyFailure };

function base64urlDecode(input: string): Buffer | null {
  // Re-pad and translate URL-safe alphabet → standard base64.
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const std = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    return Buffer.from(std, "base64");
  } catch {
    return null;
  }
}

/**
 * Parse and verify a Meta `signed_request` value.
 *
 * Format: `<base64url-HMAC-SHA256>.<base64url-JSON-payload>`
 * The HMAC is taken over the *encoded* payload string (not the decoded JSON),
 * keyed by the Meta App secret. Verification uses constant-time comparison.
 *
 * Fails closed: empty input, empty secret, malformed structure, signature
 * mismatch, non-JSON payload, or payload missing `user_id` all return
 * `{ ok: false, reason }`. Never throws on bad input.
 */
export function parseAndVerifySignedRequest(
  signedRequest: string,
  appSecret: string,
): SignedRequestResult {
  if (!signedRequest) return { ok: false, reason: "empty_input" };
  if (!appSecret) return { ok: false, reason: "empty_secret" };

  const dot = signedRequest.indexOf(".");
  if (dot <= 0 || dot === signedRequest.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const sigEncoded = signedRequest.slice(0, dot);
  const payloadEncoded = signedRequest.slice(dot + 1);

  const providedSig = base64urlDecode(sigEncoded);
  if (!providedSig || providedSig.length === 0) return { ok: false, reason: "malformed" };

  const expectedSig = createHmac("sha256", appSecret).update(payloadEncoded).digest();
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: "invalid_signature" };
  }

  const payloadBytes = base64urlDecode(payloadEncoded);
  if (!payloadBytes) return { ok: false, reason: "invalid_payload_json" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payload_json" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "invalid_payload_json" };
  }
  const payload = parsed as Record<string, unknown>;
  const userId = payload["user_id"];
  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, reason: "missing_user_id" };
  }

  return { ok: true, payload: { ...payload, user_id: userId } as MetaSignedRequestPayload };
}
