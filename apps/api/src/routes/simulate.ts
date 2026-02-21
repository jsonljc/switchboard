import type { FastifyPluginAsync } from "fastify";

export const simulateRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/simulate - Dry-run action evaluation
  app.post("/", async (request, reply) => {
    const body = request.body as {
      actionType: string;
      parameters: Record<string, unknown>;
      principalId: string;
      cartridgeId?: string;
    };

    const cartridgeId = body.cartridgeId ?? inferCartridgeId(body.actionType);
    if (!cartridgeId) {
      return reply.code(400).send({ error: "Cannot infer cartridgeId from actionType" });
    }

    try {
      const result = await app.orchestrator.simulate({
        actionType: body.actionType,
        parameters: body.parameters,
        principalId: body.principalId,
        cartridgeId,
      });

      return reply.code(200).send(result);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
};

function inferCartridgeId(actionType: string): string | null {
  if (actionType.startsWith("ads.")) return "ads-spend";
  return null;
}
