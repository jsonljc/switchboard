// ---------------------------------------------------------------------------
// Deployment Readiness Route
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { DeploymentReadinessChecker } from "@switchboard/core";

export const deploymentRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/deployment/readiness
  app.get(
    "/readiness",
    {
      schema: {
        description: "Check deployment readiness for an organization.",
        tags: ["Deployment"],
        querystring: {
          type: "object",
          properties: { orgId: { type: "string" } },
          required: ["orgId"],
        },
      },
    },
    async (request, reply) => {
      const { orgId } = request.query as { orgId: string };

      if (!app.resolvedProfile) {
        return reply.code(404).send({ error: "No business profile loaded" });
      }

      // Check if any channel is configured
      let channelConfigured = false;
      if (app.prisma) {
        const orgConfig = await app.prisma.organizationConfig.findUnique({
          where: { id: orgId },
          select: { managedChannels: true },
        });
        channelConfigured = (orgConfig?.managedChannels?.length ?? 0) > 0;
      }

      const checker = new DeploymentReadinessChecker();
      const result = checker.check(app.resolvedProfile.profile, channelConfigured);
      return reply.code(200).send(result);
    },
  );
};
