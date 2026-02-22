import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { inferCartridgeId } from "@switchboard/core";
import { SimulateBodySchema } from "../validation.js";

const simulateJsonSchema = zodToJsonSchema(SimulateBodySchema, { target: "openApi3" });

export const simulateRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/simulate - Dry-run action evaluation
  app.post("/", {
    schema: {
      description: "Dry-run action evaluation. Returns the decision trace without creating an envelope or executing anything.",
      tags: ["Simulate"],
      body: simulateJsonSchema,
    },
  }, async (request, reply) => {
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
