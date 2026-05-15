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
  return reply.code(400).send({ error: error.message, statusCode: 400 });
}
