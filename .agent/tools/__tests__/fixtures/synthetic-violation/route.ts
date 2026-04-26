import type { FastifyPluginAsync } from "fastify";

export const violationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/widgets", async (req, reply) => {
    return reply.code(201).send({ ok: true });
  });
};
