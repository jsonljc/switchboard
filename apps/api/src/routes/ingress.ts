// @route-class: operator-direct
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { boundedParameters } from "../validation.js";
import { isServiceOnlyIngressIntent } from "./service-only-intents.js";

// F11: validate the body. Models CanonicalSubmitRequest (canonical-request.ts) so
// every legitimate operator submit is accepted, while a malformed/over-shaped
// body is rejected (.strict() at the top level; parameters bounded like the
// sibling routes). NOTE: chat/CTWA does NOT use this public route — it uses the
// INTERNAL_API_SECRET /internal/ingress/submit edge.
const IngressSubmitBodySchema = z
  .object({
    organizationId: z.string().optional(),
    // No `actor` field: the actor identity is bound from the authenticated principal
    // (request.actorId), never the request body. A body carrying `actor` is rejected by
    // `.strict()` rather than silently honored — see the submit() call below.
    intent: z.string().min(1),
    parameters: boundedParameters.optional(),
    trigger: z.enum(["chat", "api", "schedule", "internal"]).optional(),
    surface: z
      .object({
        surface: z.enum(["api", "mcp", "chat", "dashboard"]),
        requestId: z.string().optional(),
        sessionId: z.string().optional(),
        correlationId: z.string().optional(),
      })
      .optional(),
    idempotencyKey: z.string().optional(),
    parentWorkUnitId: z.string().optional(),
    traceId: z.string().optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    targetHint: z
      .object({
        skillSlug: z.string().optional(),
        deploymentId: z.string().optional(),
        channel: z.string().optional(),
        token: z.string().optional(),
      })
      .optional(),
    suggestedMode: z.string().optional(),
    contactId: z.string().optional(),
    conversationThreadId: z.string().optional(),
  })
  .strict();

export const ingressRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test org binding from x-org-id / x-principal-id headers. No-op in production
  // (the real auth middleware has already populated organizationIdFromAuth).
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.post("/ingress/submit", { preHandler: requireOrgForMutation }, async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "PlatformIngress not available", statusCode: 503 });
    }

    // F11: validate the body before trusting any field.
    const parsed = IngressSubmitBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
    }
    const body = parsed.data;

    // F3: service-only intents are not accepted on the public operator edge.
    if (isServiceOnlyIngressIntent(body.intent)) {
      return reply.code(403).send({
        error: "intent_not_accepted_on_this_route",
        intent: body.intent,
        statusCode: 403,
      });
    }

    // Idempotency-Key is mandatory for raw operator ingress (DOCTRINE §6 tightening).
    const idempotencyKey = requireIdempotencyKey(request, reply);
    if (!idempotencyKey) return;

    try {
      const response = await app.platformIngress.submit({
        organizationId: request.orgId,
        // Bound from the authenticated principal (requireOrgForMutation sets
        // request.actorId from principalIdFromAuth), NEVER the request body. This is
        // the canonical WorkTrace actor and the identity GovernanceGate resolves, so a
        // body-supplied actor would be audit forgery + a governance trust-level spoof.
        actor: { id: request.actorId, type: "user" },
        intent: body.intent,
        parameters: body.parameters ?? {},
        trigger: body.trigger ?? "api",
        surface: body.surface ?? { surface: "api" },
        targetHint: body.targetHint,
        traceId: body.traceId,
        idempotencyKey,
      });

      return reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error("[IngressRoute] submit error:", err);
      return reply.code(500).send({
        ok: false,
        error: { type: "internal_error", message },
        statusCode: 500,
      });
    }
  });
};
