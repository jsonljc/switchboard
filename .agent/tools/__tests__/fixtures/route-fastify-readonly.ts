import type { FastifyPluginAsync } from "fastify";

export const exampleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/things", async () => ({ ok: true }));
};
