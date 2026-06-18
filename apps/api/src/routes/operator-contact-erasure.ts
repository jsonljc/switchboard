// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Operator-initiated PDPA right-to-erasure. An operator who receives a
// stop-contacting / erase request by phone or email fulfils it here: the same
// full delete cascade as the Meta data-deletion callback (eraseContactFully),
// but reachable by a human operator. Mirrors the receipted-booking-reconcile
// operator-direct pattern: the mutation enters through PlatformIngress.submit()
// (no bypass), the authenticated org is authoritative (the :orgId path param is
// informational; requireOrgForAuditedMutation makes the auth org/principal
// authoritative and rejects an unbound principal in production so the audit
// trail always has a real actor), and an Idempotency-Key is required. A contact
// that does not belong to the authenticated org reads as not-found (fail-closed
// cross-tenant) and maps to 404.
// ---------------------------------------------------------------------------
import type { FastifyPluginAsync } from "fastify";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForAuditedMutation } from "../decorators/org.js";
import { OPERATOR_INTENT_ERROR_CODES } from "../bootstrap/operator-intents/shared.js";
import { ERASE_CONTACT_INTENT } from "../bootstrap/operator-intents.js";

export const operatorContactErasureRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.post(
    "/:orgId/contacts/:contactId/erase",
    { preHandler: requireOrgForAuditedMutation },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const { contactId } = request.params as { orgId: string; contactId: string };

      const response = await app.platformIngress.submit({
        intent: ERASE_CONTACT_INTENT,
        parameters: { contactId },
        actor: { id: request.actorId, type: "user" },
        organizationId: request.orgId, // auth is authoritative; :orgId path param is informational only
        contactId,
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      // system_auto_approved + non-financial, so it never parks; still branch on approvalRequired
      // before reading the result (the pending_approval lesson) in case a future policy parks it.
      if ("approvalRequired" in response && response.approvalRequired) {
        return reply
          .code(202)
          .send({ status: "pending_approval", traceId: response.result.traceId });
      }
      if (response.result.outcome === "failed") {
        const code = response.result.error?.code;
        if (code === OPERATOR_INTENT_ERROR_CODES.CONTACT_NOT_FOUND) {
          return reply.code(404).send({ error: "Contact not found", statusCode: 404 });
        }
        throw new Error(response.result.error?.message ?? "Erase failed");
      }
      return reply.code(200).send({
        status: "erased",
        contactId: response.result.outputs?.contactId ?? contactId,
      });
    },
  );
};
