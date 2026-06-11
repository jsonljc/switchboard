// @route-class: lifecycle
import type { FastifyPluginAsync } from "fastify";
import { verifyInternalSecret } from "../lib/internal-secret-auth.js";
import { InternalIngressSubmitBodySchema } from "../validation.js";
import { isServiceOnlyIngressIntent } from "./service-only-intents.js";

// Internal chat-to-API ingress hop
// (spec docs/superpowers/specs/2026-06-08-f-15-chat-ingress-auth-design.md).
//
// The chat service is a single shared process serving every org's managed channels. It
// resolves the authoritative org SERVER-SIDE from the channel token (channel-gateway.ts)
// and carries it in body.organizationId. This route authenticates the CALLER PROCESS via
// INTERNAL_API_SECRET (timing-safe; same trust model as /internal/provision-notify and
// /api/internal/chat-approvals/respond) and honors that org. It calls
// app.platformIngress.submit, so PlatformIngress runs entitlement + GovernanceGate +
// idempotency unchanged: this is NOT a mutating bypass. The path is excluded from the
// API-key auth middleware (exact path) and self-authenticates here, fail closed.

const RATE_LIMIT_MAX = 600; // message-rate, not human-tap
const RATE_LIMIT_WINDOW_MS = 60_000;

export const internalIngressRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/submit",
    {
      schema: {
        description:
          "Internal chat-to-API ingress: authenticated by INTERNAL_API_SECRET, honors the " +
          "chat-resolved body.organizationId, and submits through PlatformIngress.",
        tags: ["Internal"],
        // Public /docs is auth-excluded; an internal surface must not advertise itself.
        hide: true,
      },
      config: { rateLimit: { max: RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW_MS } },
    },
    async (request, reply) => {
      const secretState = verifyInternalSecret(request);
      if (secretState === "unauthorized") {
        return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });
      }
      if (secretState === "unconfigured" && app.authDisabled !== true) {
        request.log.error("INTERNAL_API_SECRET not configured; rejecting internal ingress");
        return reply
          .code(503)
          .send({ error: "Internal authentication not configured", statusCode: 503 });
      }
      // secretState === "ok", or "unconfigured" in auth-disabled dev mode: proceed.

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "PlatformIngress not available", statusCode: 503 });
      }

      const parsed = InternalIngressSubmitBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }
      const body = parsed.data;

      // F3: service-only intents (e.g. payment.record_verified) must not be
      // submittable on ANY HTTP edge — only trusted in-process submitters (the
      // HMAC-verified payments webhook) may. The handler also re-verifies against
      // the PSP, but keep the two ingress doors symmetric so no service-only
      // intent is exposed on one but blocked on the other.
      if (isServiceOnlyIngressIntent(body.intent)) {
        return reply.code(403).send({
          error: "intent_not_accepted_on_this_route",
          intent: body.intent,
          statusCode: 403,
        });
      }

      try {
        const response = await app.platformIngress.submit({
          organizationId: body.organizationId,
          actor: body.actor,
          intent: body.intent,
          parameters: body.parameters ?? {},
          trigger: body.trigger ?? "chat",
          surface: body.surface ?? { surface: "chat" },
          targetHint: body.targetHint,
          traceId: body.traceId,
          ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
          ...(body.contactId ? { contactId: body.contactId } : {}),
          ...(body.conversationThreadId ? { conversationThreadId: body.conversationThreadId } : {}),
          ...(body.parentWorkUnitId ? { parentWorkUnitId: body.parentWorkUnitId } : {}),
        });
        request.log.info(
          { organizationId: body.organizationId, intent: body.intent, ok: response.ok },
          "internal ingress submit",
        );
        return reply.send(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        request.log.error({ err }, "internal ingress submit error");
        return reply
          .code(500)
          .send({ ok: false, error: { type: "internal_error", message }, statusCode: 500 });
      }
    },
  );
};
