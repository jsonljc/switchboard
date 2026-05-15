import type { FastifyRequest } from "fastify";

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
