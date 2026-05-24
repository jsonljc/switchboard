// @route-class: operator-direct
import type { FastifyPluginAsync } from "fastify";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";

export const ingressRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test org binding from x-org-id / x-principal-id headers. No-op in production
  // (the real auth middleware has already populated organizationIdFromAuth).
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.post("/ingress/submit", { preHandler: requireOrgForMutation }, async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "PlatformIngress not available", statusCode: 503 });
    }

    const body = request.body as {
      actor: { id: string; type: string };
      intent: string;
      parameters: Record<string, unknown>;
      trigger: string;
      surface?: { surface: "chat" | "dashboard" | "mcp" | "api"; sessionId?: string };
      targetHint?: Record<string, unknown>;
      traceId?: string;
      idempotencyKey?: string;
    };

    if (!body.intent) {
      return reply.code(400).send({ error: "Missing intent", statusCode: 400 });
    }

    // Idempotency-Key is mandatory for raw operator ingress (DOCTRINE §6 tightening).
    const idempotencyKey = requireIdempotencyKey(request, reply);
    if (!idempotencyKey) return;

    try {
      const response = await app.platformIngress.submit({
        organizationId: request.orgId,
        actor: { id: body.actor?.id ?? "anonymous", type: (body.actor?.type ?? "user") as "user" },
        intent: body.intent,
        parameters: body.parameters ?? {},
        trigger: (body.trigger ?? "api") as "api" | "chat" | "schedule",
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
