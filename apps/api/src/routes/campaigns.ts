import type { FastifyPluginAsync } from "fastify";

export const campaignsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/campaigns/:id
  app.get("/:id", {
    schema: {
      description: "Get campaign details by ID.",
      tags: ["Campaigns"],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const cartridge = app.storageContext.cartridges.get("digital-ads");
    if (!cartridge) {
      return reply.code(503).send({ error: "Digital ads cartridge not available", statusCode: 503 });
    }

    if (typeof (cartridge as any).getCampaign !== "function") {
      return reply.code(501).send({ error: "getCampaign not implemented", statusCode: 501 });
    }

    try {
      const campaign = await (cartridge as any).getCampaign(id);
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
  });

  // GET /api/campaigns/search?query=...
  app.get("/search", {
    schema: {
      description: "Search campaigns by query string.",
      tags: ["Campaigns"],
    },
  }, async (request, reply) => {
    const query = request.query as { query?: string; limit?: string };

    if (!query.query) {
      return reply.code(400).send({ error: "query parameter is required", statusCode: 400 });
    }

    const cartridge = app.storageContext.cartridges.get("digital-ads");
    if (!cartridge) {
      return reply.code(503).send({ error: "Digital ads cartridge not available", statusCode: 503 });
    }

    if (typeof (cartridge as any).searchCampaigns !== "function") {
      return reply.code(501).send({ error: "searchCampaigns not implemented", statusCode: 501 });
    }

    try {
      const campaigns = await (cartridge as any).searchCampaigns(query.query);
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
  });
};
