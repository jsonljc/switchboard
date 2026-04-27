import type { FastifyPluginAsync } from "fastify";

export const exampleRoutes: FastifyPluginAsync = async (app) => {
  app.post("/things", async (req, reply) => {
    return reply.code(201).send({ ok: true });
  });
  app.get("/things", async () => ({ ok: true }));
};
