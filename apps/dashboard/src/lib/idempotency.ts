/**
 * Generate a fresh Idempotency-Key for an operator-direct mutation.
 *
 * Preflight for Route Governance Contract v1 PR-1: the upcoming server-side
 * mandate requires every POST/PATCH/DELETE on the 7 operator-direct endpoints
 * to carry an `Idempotency-Key` header for replay protection. This helper
 * centralizes generation so callers never invent their own scheme.
 *
 * Uses `globalThis.crypto.randomUUID` when available (modern browsers, Node
 * 19+, Edge runtime). Falls back to a `idemp_<ts>_<rand>` shape when the
 * Web Crypto API is unavailable or `randomUUID` is missing — the server
 * accepts any non-empty string under 256 chars (see api/src/middleware/idempotency.ts).
 */
export function createIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `idemp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
