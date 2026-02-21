import type { FastifyPluginAsync } from "fastify";

export const identityRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/identity/specs
  app.get("/specs", async (_request, reply) => {
    return reply.code(200).send({ specs: [] });
  });

  // POST /api/identity/specs
  app.post("/specs", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const id = `spec_${Date.now()}`;
    return reply.code(201).send({ id, ...body });
  });

  // GET /api/identity/specs/:id
  app.get("/specs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(200).send({ id, status: "not_found" });
  });

  // PUT /api/identity/specs/:id
  app.put("/specs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return reply.code(200).send({ id, ...body });
  });

  // GET /api/identity/overlays
  app.get("/overlays", async (_request, reply) => {
    return reply.code(200).send({ overlays: [] });
  });

  // POST /api/identity/overlays
  app.post("/overlays", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const id = `overlay_${Date.now()}`;
    return reply.code(201).send({ id, ...body });
  });

  // PUT /api/identity/overlays/:id
  app.put("/overlays/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return reply.code(200).send({ id, ...body });
  });
};
