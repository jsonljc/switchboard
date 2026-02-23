import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Policy } from "@switchboard/schemas";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CreatePolicyBodySchema, UpdatePolicyBodySchema } from "../validation.js";

const createPolicyJsonSchema = zodToJsonSchema(CreatePolicyBodySchema, { target: "openApi3" });
const updatePolicyJsonSchema = zodToJsonSchema(UpdatePolicyBodySchema, { target: "openApi3" });

export const policiesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/policies
  app.get("/", {
    schema: {
      description: "List all active policies. Optionally filter by cartridgeId.",
      tags: ["Policies"],
      querystring: { type: "object", properties: { cartridgeId: { type: "string" } } },
    },
  }, async (request, reply) => {
    const query = request.query as { cartridgeId?: string };
    const policies = await app.storageContext.policies.listActive(
      query.cartridgeId ? { cartridgeId: query.cartridgeId } : undefined,
    );
    return reply.code(200).send({ policies });
  });

  // POST /api/policies
  app.post("/", {
    schema: {
      description: "Create a new guardrail policy.",
      tags: ["Policies"],
      body: createPolicyJsonSchema,
    },
  }, async (request, reply) => {
    const parsed = CreatePolicyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const now = new Date();
    const policy: Policy = {
      id: `policy_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      ...parsed.data,
    };

    await app.storageContext.policies.save(policy);
    await app.policyCache.invalidate(policy.cartridgeId ?? undefined);
    return reply.code(201).send({ policy });
  });

  // GET /api/policies/:id
  app.get("/:id", {
    schema: {
      description: "Get a policy by ID.",
      tags: ["Policies"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const policy = await app.storageContext.policies.getById(id);
    if (!policy) {
      return reply.code(404).send({ error: "Policy not found" });
    }
    return reply.code(200).send({ policy });
  });

  // PUT /api/policies/:id
  app.put("/:id", {
    schema: {
      description: "Update an existing policy.",
      tags: ["Policies"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: updatePolicyJsonSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsed = UpdatePolicyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const existing = await app.storageContext.policies.getById(id);
    if (!existing) {
      return reply.code(404).send({ error: "Policy not found" });
    }

    await app.storageContext.policies.update(id, {
      ...parsed.data,
      updatedAt: new Date(),
    });
    await app.policyCache.invalidate(existing.cartridgeId ?? undefined);
    const updated = await app.storageContext.policies.getById(id);
    return reply.code(200).send({ policy: updated });
  });

  // DELETE /api/policies/:id
  app.delete("/:id", {
    schema: {
      description: "Delete a policy by ID.",
      tags: ["Policies"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await app.storageContext.policies.getById(id);
    const deleted = await app.storageContext.policies.delete(id);
    if (!deleted) {
      return reply.code(404).send({ error: "Policy not found" });
    }
    if (existing) await app.policyCache.invalidate(existing.cartridgeId ?? undefined);
    return reply.code(200).send({ id, deleted: true });
  });
};
