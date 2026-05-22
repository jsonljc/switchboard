import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Reads the `Idempotency-Key` HTTP header from a Fastify request.
 *
 * Returns the trimmed string when present and non-empty; `undefined` otherwise.
 * `PlatformIngress.submit()` treats absence as "do not dedup," so the caller
 * can spread the result conditionally:
 *
 * ```ts
 * const idempotencyKey = getIdempotencyKey(request);
 * await platformIngress.submit({
 *   ...common,
 *   ...(idempotencyKey ? { idempotencyKey } : {}),
 * });
 * ```
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * Decision 5.
 */
export function getIdempotencyKey(request: FastifyRequest): string | undefined {
  const raw = request.headers["idempotency-key"];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Mandatory variant of {@link getIdempotencyKey}: when the `Idempotency-Key`
 * header is missing or invalid, sends a 400 response and returns `null`. Route
 * handlers short-circuit on a `null` return with `if (!key) return;`.
 *
 * Used by operator-direct routes per the Route Governance Contract v1 (§7.1).
 * Other route classes use `getIdempotencyKey` (optional) or omit the contract
 * entirely.
 */
export function requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const key = getIdempotencyKey(request);
  if (!key) {
    reply.code(400).send({
      error: "missing_idempotency_key",
      hint: "Idempotency-Key header is required for this endpoint",
      statusCode: 400,
    });
    return null;
  }
  return key;
}
