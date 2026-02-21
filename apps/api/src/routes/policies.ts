import type { FastifyPluginAsync } from "fastify";

export const policiesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/policies
  app.get("/", async (_request, reply) => {
    return reply.code(200).send({ policies: [] });
  });

  // POST /api/policies
  app.post("/", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const id = `policy_${Date.now()}`;
    return reply.code(201).send({ id, ...body, createdAt: new Date().toISOString() });
  });

  // GET /api/policies/:id
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(200).send({ id, status: "not_found" });
  });

  // PUT /api/policies/:id
  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return reply.code(200).send({ id, ...body, updatedAt: new Date().toISOString() });
  });

  // DELETE /api/policies/:id
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(200).send({ id, deleted: true });
  });
};
