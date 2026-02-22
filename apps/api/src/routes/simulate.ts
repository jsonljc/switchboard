import type { FastifyPluginAsync } from "fastify";
import { SimulateBodySchema } from "../validation.js";

export const simulateRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/simulate - Dry-run action evaluation
  app.post("/", async (request, reply) => {
    const parsed = SimulateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

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
