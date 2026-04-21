import type { FastifyPluginAsync } from "fastify";

export const ingressRoutes: FastifyPluginAsync = async (app) => {
  app.post("/ingress/submit", async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "PlatformIngress not available" });
    }

    const body = request.body as {
      organizationId: string;
      actor: { id: string; type: string };
      intent: string;
      parameters: Record<string, unknown>;
      trigger: string;
      surface?: { surface: "chat" | "dashboard" | "mcp" | "api"; sessionId?: string };
      targetHint?: Record<string, unknown>;
      traceId?: string;
      idempotencyKey?: string;
    };

    if (!body.organizationId || !body.intent) {
      return reply.code(400).send({ error: "Missing organizationId or intent" });
    }

    try {
      const response = await app.platformIngress.submit({
        organizationId: body.organizationId,
        actor: { id: body.actor?.id ?? "anonymous", type: (body.actor?.type ?? "user") as "user" },
        intent: body.intent,
        parameters: body.parameters ?? {},
        trigger: (body.trigger ?? "api") as "api" | "chat" | "schedule",
        surface: body.surface ?? { surface: "api" },
        targetHint: body.targetHint,
        traceId: body.traceId,
        idempotencyKey: body.idempotencyKey,
      });

      return reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error("[IngressRoute] submit error:", err);
      return reply.code(500).send({
        ok: false,
        error: { type: "internal_error", message },
      });
    }
  });
};
