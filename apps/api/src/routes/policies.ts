import type { FastifyPluginAsync } from "fastify";
import type { Policy } from "@switchboard/schemas";
import { CreatePolicyBodySchema, UpdatePolicyBodySchema } from "../validation.js";

export const policiesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/policies
  app.get("/", async (request, reply) => {
    const query = request.query as { cartridgeId?: string };
    const policies = await app.storageContext.policies.listActive(
      query.cartridgeId ? { cartridgeId: query.cartridgeId } : undefined,
    );
    return reply.code(200).send({ policies });
  });

  // POST /api/policies
  app.post("/", async (request, reply) => {
    const parsed = CreatePolicyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }

    const now = new Date();
    const policy: Policy = {
      id: `policy_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      ...parsed.data,
    };

    await app.storageContext.policies.save(policy);
    return reply.code(201).send({ policy });
  });

  // GET /api/policies/:id
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const policy = await app.storageContext.policies.getById(id);
    if (!policy) {
      return reply.code(404).send({ error: "Policy not found" });
    }
    return reply.code(200).send({ policy });
  });

  // PUT /api/policies/:id
  app.put("/:id", async (request, reply) => {
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
    const updated = await app.storageContext.policies.getById(id);
    return reply.code(200).send({ policy: updated });
  });

  // DELETE /api/policies/:id
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await app.storageContext.policies.delete(id);
    if (!deleted) {
      return reply.code(404).send({ error: "Policy not found" });
    }
    return reply.code(200).send({ id, deleted: true });
  });
};
