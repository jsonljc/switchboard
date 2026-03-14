// ---------------------------------------------------------------------------
// Flow Builder API Routes — CRUD for conversation flow definitions
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { FlowConfigSchema } from "@switchboard/schemas";
import { validateFlowDefinition } from "@switchboard/core";

export const flowBuilderRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/flows/validate
  app.post(
    "/validate",
    {
      schema: {
        description: "Validate a conversation flow definition.",
        tags: ["Flow Builder"],
      },
    },
    async (request, reply) => {
      const parsed = FlowConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid flow config schema", details: parsed.error.issues });
      }

      const results = parsed.data.flows.map((flow) => ({
        flowId: flow.id,
        ...validateFlowDefinition(flow),
      }));

      const allValid = results.every((r) => r.valid);
      return reply.code(allValid ? 200 : 422).send({
        valid: allValid,
        results,
      });
    },
  );

  // POST /api/flows/parse
  app.post(
    "/parse",
    {
      schema: {
        description: "Parse and validate a flow config JSON payload.",
        tags: ["Flow Builder"],
      },
    },
    async (request, reply) => {
      const parsed = FlowConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Schema validation failed", details: parsed.error.issues });
      }
      return reply.code(200).send({ config: parsed.data });
    },
  );
};
