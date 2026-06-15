// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Receipted-booking reconcile - the owner acts on the proof-quality worklist
// (#1088): override a wrong attribution, flag a duplicate contact, or dismiss a
// duplicate flag. Mirrors the booking-attendance operator-direct pattern: the
// mutation enters through PlatformIngress.submit() (no bypass). The :orgId path
// param is informational; requireOrgForMutation makes the authenticated org
// authoritative, and the authenticated actor is the override's overriddenBy. A
// missing booking / un-issued row maps to 404; an unsupported reconcile code or
// bad params maps to 400; any other failed outcome is an unexpected execution
// error (500).
// ---------------------------------------------------------------------------
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AttributionConfidenceSchema, ExceptionCodeSchema } from "@switchboard/schemas";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { OPERATOR_INTENT_ERROR_CODES } from "../bootstrap/operator-intents/shared.js";
import { RECONCILE_BOOKING_INTENT } from "../bootstrap/operator-intents.js";

// The request body is the reconcile action WITHOUT bookingId (it is the path param). The full
// parameter schema (with bookingId) is re-validated in the handler.
const ReconcileBookingBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("override_attribution"),
    confidence: AttributionConfidenceSchema,
    reason: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("flag_duplicate"),
    detail: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("resolve_exception"),
    code: ExceptionCodeSchema,
  }),
]);

export const receiptedBookingReconcileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.post(
    "/:orgId/bookings/:bookingId/reconcile",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = ReconcileBookingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
      }

      const { bookingId } = request.params as { orgId: string; bookingId: string };

      const response = await app.platformIngress.submit({
        intent: RECONCILE_BOOKING_INTENT,
        parameters: { bookingId, ...parsed.data },
        actor: { id: request.actorId, type: "user" },
        organizationId: request.orgId, // auth is authoritative; :orgId path param is informational only
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
        if (
          code === OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND ||
          code === OPERATOR_INTENT_ERROR_CODES.RECEIPTED_BOOKING_NOT_ISSUED
        ) {
          return reply.code(404).send({ error: "Booking not found", statusCode: 404 });
        }
        if (code === OPERATOR_INTENT_ERROR_CODES.RECONCILE_UNSUPPORTED_CODE) {
          return reply.code(400).send({ error: "Unsupported reconcile code", statusCode: 400 });
        }
        throw new Error(response.result.error?.message ?? "Reconcile failed");
      }
      return reply.code(200).send({
        status: response.result.outputs?.status ?? "applied",
        created: response.result.outputs?.created ?? false,
      });
    },
  );
};
