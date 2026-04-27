import type { FastifyPluginAsync } from "fastify";
import { PlatformIngress } from "@switchboard/core";

export const cleanRoutes: FastifyPluginAsync = async (app) => {
  app.post("/widgets", async (req, reply) => {
    await PlatformIngress.submit({});
    return reply.code(201).send({ ok: true });
  });
};
