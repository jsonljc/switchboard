// ---------------------------------------------------------------------------
// Deployment Readiness Route
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { DeploymentReadinessChecker } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

export const deploymentRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/deployment/readiness
  app.get(
    "/readiness",
    {
      schema: {
        description: "Check deployment readiness for the authenticated organization.",
        tags: ["Deployment"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

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
