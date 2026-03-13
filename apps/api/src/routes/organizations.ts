import type { FastifyPluginAsync } from "fastify";
import { orgConfigRoutes } from "./org-config.js";
import { orgChannelsRoutes } from "./org-channels.js";
import { orgHandoffRoutes } from "./org-handoff.js";

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(orgConfigRoutes);
  await app.register(orgChannelsRoutes);
  await app.register(orgHandoffRoutes);
};
