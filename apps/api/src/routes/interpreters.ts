import type { FastifyPluginAsync } from "fastify";
import { InterpreterConfigSchema, RoutingConfigSchema } from "../validation.js";
import { assertOrgAccess } from "../utils/org-access.js";
import { requireRole } from "../utils/require-role.js";

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
    },
  }, async (request, reply) => {
    if (!(await requireRole(request, reply, "admin"))) return;

    const parsed = InterpreterConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const body = parsed.data;
    const existing = interpreterConfigs.get(body.name);

    const config: InterpreterConfig = {
      name: body.name,
      enabled: body.enabled ?? existing?.enabled ?? true,
      priority: body.priority ?? existing?.priority ?? 100,
      model: body.model ?? existing?.model,
      provider: body.provider ?? existing?.provider,
    };

    interpreterConfigs.set(body.name, config);

    // Audit: record interpreter registration/update
    await app.auditLedger.record({
      eventType: "policy.updated",
      actorType: "user",
      actorId: request.principalIdFromAuth ?? "unknown",
      entityType: "interpreter",
      entityId: body.name,
      riskCategory: "low",
      summary: `Interpreter "${body.name}" ${existing ? "updated" : "registered"}`,
      snapshot: { config, previous: existing ?? null },
      organizationId: request.organizationIdFromAuth ?? undefined,
    });

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
    if (!(await requireRole(request, reply, "admin"))) return;

    const { name } = request.params as { name: string };
    const config = interpreterConfigs.get(name);
    if (!config) {
      return reply.code(404).send({ error: `Interpreter ${name} not found` });
    }
    config.enabled = true;

    // Audit: record interpreter enabled
    await app.auditLedger.record({
      eventType: "policy.updated",
      actorType: "user",
      actorId: request.principalIdFromAuth ?? "unknown",
      entityType: "interpreter",
      entityId: name,
      riskCategory: "low",
      summary: `Interpreter "${name}" enabled`,
      snapshot: { config },
      organizationId: request.organizationIdFromAuth ?? undefined,
    });

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
    if (!(await requireRole(request, reply, "admin"))) return;

    const { name } = request.params as { name: string };
    const config = interpreterConfigs.get(name);
    if (!config) {
      return reply.code(404).send({ error: `Interpreter ${name} not found` });
    }
    config.enabled = false;

    // Audit: record interpreter disabled
    await app.auditLedger.record({
      eventType: "policy.updated",
      actorType: "user",
      actorId: request.principalIdFromAuth ?? "unknown",
      entityType: "interpreter",
      entityId: name,
      riskCategory: "medium",
      summary: `Interpreter "${name}" disabled`,
      snapshot: { config },
      organizationId: request.organizationIdFromAuth ?? undefined,
    });

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
    },
  }, async (request, reply) => {
    const parsed = RoutingConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const body = parsed.data;

    // Verify the body organizationId matches the authenticated org
    const authOrgId = request.organizationIdFromAuth;
    if (authOrgId && body.organizationId !== authOrgId) {
      return reply.code(403).send({ error: "Forbidden: organization mismatch" });
    }

    const config: RoutingConfig = {
      organizationId: body.organizationId,
      preferredInterpreter: body.preferredInterpreter,
      fallbackChain: body.fallbackChain ?? [],
    };
    routingConfigs.set(body.organizationId, config);

    // Audit: record routing config change
    await app.auditLedger.record({
      eventType: "policy.updated",
      actorType: "user",
      actorId: request.principalIdFromAuth ?? "unknown",
      entityType: "interpreter_routing",
      entityId: body.organizationId,
      riskCategory: "low",
      summary: `Interpreter routing set for org "${body.organizationId}"`,
      snapshot: { config },
      organizationId: request.organizationIdFromAuth ?? undefined,
    });

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
    if (!(await requireRole(request, reply, "admin"))) return;

    const { organizationId } = request.params as { organizationId: string };

    // Org-access check on the routing being deleted
    if (!assertOrgAccess(request, organizationId, reply)) return;

    const existed = routingConfigs.delete(organizationId);

    if (existed) {
      // Audit: record routing deletion
      await app.auditLedger.record({
        eventType: "policy.deleted",
        actorType: "user",
        actorId: request.principalIdFromAuth ?? "unknown",
        entityType: "interpreter_routing",
        entityId: organizationId,
        riskCategory: "medium",
        summary: `Interpreter routing removed for org "${organizationId}"`,
        snapshot: { organizationId },
        organizationId: request.organizationIdFromAuth ?? undefined,
      });
    }

    return reply.code(200).send({ deleted: existed });
  });
};
