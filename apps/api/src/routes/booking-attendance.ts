// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Booking attendance route — staff/owner records attended | no_show.
//
// Mirrors the revenue operator-direct pattern: every mutation enters through
// PlatformIngress.submit() (no bypass path). The :orgId path param is
// informational; requireOrgForMutation makes the authenticated org
// authoritative. The booking.record_attendance handler maps a missing booking
// (StaleVersionError → BOOKING_NOT_FOUND) to a failed outcome, surfaced here as
// a 404 — every other failed outcome is an unexpected execution error (500).
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { OPERATOR_INTENT_ERROR_CODES } from "../bootstrap/operator-intents/shared.js";
import { RECORD_ATTENDANCE_INTENT } from "../bootstrap/operator-intents.js";

// ── Input Validation Schema ──

const RecordAttendanceInputSchema = z.object({
  outcome: z.enum(["attended", "no_show"]),
  recordedBy: z.enum(["owner", "staff"]).default("owner"),
});

export const bookingAttendanceRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test mode (authDisabled): populate organizationIdFromAuth +
  // principalIdFromAuth from x-org-id / x-principal-id headers (or fall back to
  // "default"). In production this hook is a no-op; the real auth middleware has
  // already populated the fields.
  app.addHook("preHandler", buildDevAuthFallback(app));

  // POST /:orgId/bookings/:bookingId/attendance — record attended | no_show.
  app.post(
    "/:orgId/bookings/:bookingId/attendance",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = RecordAttendanceInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
      }

      const { bookingId } = request.params as { orgId: string; bookingId: string };

      const response = await app.platformIngress.submit({
        intent: RECORD_ATTENDANCE_INTENT,
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
      if (response.result.outcome === "failed") {
        // The only domain-failure path is a missing booking for this org. Map it
        // to 404. Any other failed outcome is an unexpected execution error —
        // throw so the global error handler returns a scrubbed 500 (don't echo
        // internal error codes/messages to the client).
        if (response.result.error?.code === OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND) {
          return reply.code(404).send({ error: "Booking not found", statusCode: 404 });
        }
        throw new Error(response.result.error?.message ?? "Attendance recording failed");
      }
      return reply.code(200).send({ booking: response.result.outputs?.booking });
    },
  );
};
