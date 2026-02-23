import type { FastifyPluginAsync } from "fastify";

/**
 * Interpreter management API.
 * The actual InterpreterRegistry lives in the chat app, so this endpoint
 * manages a configuration store that the chat app reads on startup/reload.
 * For now, we store config in-memory on the API server and expose it
 * for the chat app to poll.
 */

interface InterpreterConfig {
  name: string;
  enabled: boolean;
  priority: number;
  model?: string;
  provider?: string;
}

interface RoutingConfig {
  organizationId: string;
  preferredInterpreter: string;
  fallbackChain: string[];
}

// In-memory config store (would be DB-backed in production)
const interpreterConfigs: Map<string, InterpreterConfig> = new Map();
const routingConfigs: Map<string, RoutingConfig> = new Map();

export const interpretersRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/interpreters - List all interpreter configs
  app.get("/", {
    schema: {
      description: "List all registered interpreter configurations.",
      tags: ["Interpreters"],
    },
  }, async (_request, reply) => {
    const configs = [...interpreterConfigs.values()].sort((a, b) => a.priority - b.priority);
    return reply.code(200).send({ interpreters: configs });
  });

  // POST /api/interpreters - Register or update an interpreter config
  app.post("/", {
    schema: {
      description: "Register or update an interpreter configuration.",
      tags: ["Interpreters"],
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          enabled: { type: "boolean" },
          priority: { type: "number" },
          model: { type: "string" },
          provider: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as InterpreterConfig;
    const existing = interpreterConfigs.get(body.name);

    const config: InterpreterConfig = {
      name: body.name,
      enabled: body.enabled ?? existing?.enabled ?? true,
      priority: body.priority ?? existing?.priority ?? 100,
      model: body.model ?? existing?.model,
      provider: body.provider ?? existing?.provider,
    };

    interpreterConfigs.set(body.name, config);

    return reply.code(200).send({
      action: existing ? "updated" : "registered",
      interpreter: config,
    });
  });

  // POST /api/interpreters/:name/enable - Enable an interpreter
  app.post("/:name/enable", {
    schema: {
      description: "Enable an interpreter.",
      tags: ["Interpreters"],
      params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const config = interpreterConfigs.get(name);
    if (!config) {
      return reply.code(404).send({ error: `Interpreter ${name} not found` });
    }
    config.enabled = true;
    return reply.code(200).send({ interpreter: config });
  });

  // POST /api/interpreters/:name/disable - Disable an interpreter
  app.post("/:name/disable", {
    schema: {
      description: "Disable an interpreter.",
      tags: ["Interpreters"],
      params: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const config = interpreterConfigs.get(name);
    if (!config) {
      return reply.code(404).send({ error: `Interpreter ${name} not found` });
    }
    config.enabled = false;
    return reply.code(200).send({ interpreter: config });
  });

  // GET /api/interpreters/routing - List all organization routing configs
  app.get("/routing", {
    schema: {
      description: "List all organization interpreter routing configurations.",
      tags: ["Interpreters"],
    },
  }, async (_request, reply) => {
    return reply.code(200).send({ routing: [...routingConfigs.values()] });
  });

  // POST /api/interpreters/routing - Set organization routing
  app.post("/routing", {
    schema: {
      description: "Set interpreter routing for an organization.",
      tags: ["Interpreters"],
      body: {
        type: "object",
        required: ["organizationId", "preferredInterpreter"],
        properties: {
          organizationId: { type: "string" },
          preferredInterpreter: { type: "string" },
          fallbackChain: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as RoutingConfig;
    const config: RoutingConfig = {
      organizationId: body.organizationId,
      preferredInterpreter: body.preferredInterpreter,
      fallbackChain: body.fallbackChain ?? [],
    };
    routingConfigs.set(body.organizationId, config);
    return reply.code(200).send({ routing: config });
  });

  // DELETE /api/interpreters/routing/:organizationId - Remove org routing
  app.delete("/routing/:organizationId", {
    schema: {
      description: "Remove interpreter routing for an organization.",
      tags: ["Interpreters"],
      params: { type: "object", properties: { organizationId: { type: "string" } }, required: ["organizationId"] },
    },
  }, async (request, reply) => {
    const { organizationId } = request.params as { organizationId: string };
    const existed = routingConfigs.delete(organizationId);
    return reply.code(200).send({ deleted: existed });
  });
};
