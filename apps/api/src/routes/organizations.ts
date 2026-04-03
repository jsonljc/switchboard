import type { FastifyPluginAsync } from "fastify";

export const organizationsRoutes: FastifyPluginAsync = async (_app) => {
  // Domain-specific org sub-routes (config, channels, handoff) removed
  // in AI Workforce Platform pivot. Employee-level config is in /api/employees.
};
