import type { FastifyReply } from "fastify";
import type { IngressError } from "@switchboard/core/platform";

/**
 * Maps a `PlatformIngress.submit()` `response.error` (when `response.ok` is
 * false) to an HTTP reply. Used by operator-direct ingress routes migrated
 * under Wave 2 Phase 1b.
 *
 * Mapping:
 * - `intent_not_found` / `deployment_not_found` → 404
 * - `entitlement_required` → 402 (payment required)
 * - `idempotency_in_flight` → 409 (conflict; D1 unresolved-claim, carries retryable)
 * - everything else → 400
 *
 * See `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md`
 * "Shared helpers (one-time additions)".
 */
export function ingressErrorToReply(error: IngressError, reply: FastifyReply): FastifyReply {
  if (error.type === "intent_not_found" || error.type === "deployment_not_found") {
    return reply.code(404).send({ error: error.message, statusCode: 404 });
  }
  if (error.type === "entitlement_required") {
    return reply
      .code(402)
      .send({ error: error.message, statusCode: 402, blockedStatus: error.blockedStatus });
  }
  if (error.type === "idempotency_in_flight") {
    // D1: a prior keyed attempt is unresolved and may have committed. 409
    // Conflict (not a generic 400) + the retryable flag so SDKs/operators know
    // not to blindly retry and that reconciliation/escalation may be needed.
    return reply
      .code(409)
      .send({ error: error.message, statusCode: 409, retryable: error.retryable ?? false });
  }
  return reply.code(400).send({ error: error.message, statusCode: 400 });
}
