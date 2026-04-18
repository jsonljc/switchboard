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
      deployment?: Record<string, unknown>;
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
        trigger: (body.trigger ?? "api") as "api",
        deployment: body.deployment as never,
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
