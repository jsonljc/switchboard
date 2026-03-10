import type { FastifyPluginAsync } from "fastify";
import { paginationParams, paginate } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

export const crmRoutes: FastifyPluginAsync = async (app) => {
  // Helper to get PrismaCrmProvider (lazy import)
  async function getCrmProvider(organizationId: string) {
    if (!app.prisma) {
      throw { statusCode: 503, message: "Database not available" };
    }
    const { PrismaCrmProvider } = await import("@switchboard/db");
    return new PrismaCrmProvider(app.prisma, organizationId);
  }

  // GET /api/crm/contacts
  app.get(
    "/contacts",
    {
      schema: { description: "List CRM contacts with pagination.", tags: ["CRM"] },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const { limit, offset } = paginationParams(query);
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const provider = await getCrmProvider(orgId);
      const search = query["search"];

      let contacts;
      if (search) {
        contacts = await provider.searchContacts(search, limit);
      } else {
        contacts = await provider.searchContacts("", limit);
      }

      return reply.code(200).send(paginate(contacts, contacts.length, { limit, offset }));
    },
  );

  // GET /api/crm/contacts/:id
  app.get(
    "/contacts/:id",
    {
      schema: { description: "Get a single CRM contact.", tags: ["CRM"] },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const provider = await getCrmProvider(orgId);

      const contact = await provider.getContact(id);
      if (!contact) {
        return reply.code(404).send({ error: "Contact not found" });
      }
      return reply.code(200).send({ contact });
    },
  );

  // GET /api/crm/deals
  app.get(
    "/deals",
    {
      schema: { description: "List CRM deals with filters.", tags: ["CRM"] },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const { limit, offset } = paginationParams(query);
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const provider = await getCrmProvider(orgId);

      const deals = await provider.listDeals({
        pipeline: query["pipeline"],
        stage: query["stage"],
        contactId: query["contactId"],
      });

      const sliced = deals.slice(offset, offset + limit);
      return reply.code(200).send(paginate(sliced, deals.length, { limit, offset }));
    },
  );

  // GET /api/crm/deals/:id
  app.get(
    "/deals/:id",
    {
      schema: { description: "Get a single CRM deal.", tags: ["CRM"] },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const provider = await getCrmProvider(orgId);

      const deals = await provider.listDeals();
      const deal = deals.find((d) => d.id === id);
      if (!deal) {
        return reply.code(404).send({ error: "Deal not found" });
      }
      return reply.code(200).send({ deal });
    },
  );

  // GET /api/crm/activities
  app.get(
    "/activities",
    {
      schema: { description: "List CRM activities with filters.", tags: ["CRM"] },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const { limit, offset } = paginationParams(query);
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const provider = await getCrmProvider(orgId);

      const activities = await provider.listActivities({
        contactId: query["contactId"],
        dealId: query["dealId"],
        type: query["type"],
      });

      const sliced = activities.slice(offset, offset + limit);
      return reply.code(200).send(paginate(sliced, activities.length, { limit, offset }));
    },
  );

  // GET /api/crm/pipeline-status
  app.get(
    "/pipeline-status",
    {
      schema: { description: "Get aggregated pipeline status.", tags: ["CRM"] },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const provider = await getCrmProvider(orgId);

      const stages = await provider.getPipelineStatus(query["pipeline"]);
      return reply.code(200).send({ stages });
    },
  );
};
