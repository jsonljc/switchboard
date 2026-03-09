import type { FastifyPluginAsync } from "fastify";
import { getOrgScopedMetaCampaignProvider } from "../utils/meta-campaign-provider.js";

export const campaignsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/campaigns/:id
  app.get(
    "/:id",
    {
      schema: {
        description: "Get campaign details by ID.",
        tags: ["Campaigns"],
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          hint: "Verify your API key is scoped to the correct organization.",
          statusCode: 403,
        });
      }

      try {
        const provider = await getOrgScopedMetaCampaignProvider(
          app.prisma,
          request.organizationIdFromAuth,
        );
        const campaign = await provider.getCampaign(id);
        if (!campaign) {
          return reply.code(404).send({ error: "Campaign not found", statusCode: 404 });
        }
        return reply.code(200).send({ campaign });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to fetch campaign",
          statusCode: 500,
        });
      }
    },
  );

  // GET /api/campaigns/search?query=...
  app.get(
    "/search",
    {
      schema: {
        description: "Search campaigns by query string.",
        tags: ["Campaigns"],
      },
    },
    async (request, reply) => {
      const query = request.query as { query?: string; limit?: string };

      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          hint: "Verify your API key is scoped to the correct organization.",
          statusCode: 403,
        });
      }

      if (!query.query) {
        return reply.code(400).send({ error: "query parameter is required", statusCode: 400 });
      }

      try {
        const provider = await getOrgScopedMetaCampaignProvider(
          app.prisma,
          request.organizationIdFromAuth,
        );
        const campaigns = await provider.searchCampaigns(query.query);
        const limit = query.limit ? parseInt(query.limit, 10) : 20;
        return reply.code(200).send({
          campaigns: campaigns.slice(0, limit),
          total: campaigns.length,
        });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to search campaigns",
          statusCode: 500,
        });
      }
    },
  );
};
