import type { FastifyPluginAsync } from "fastify";
import { ContactsListQuerySchema } from "@switchboard/schemas";
import { listContactsForBrowse, InvalidCursorError } from "@switchboard/core/contacts";
import { requireOrganizationScope } from "../utils/require-org.js";
import { dashboardRouteTemplates } from "../lib/route-templates.js";

/**
 * GET /api/dashboard/contacts — read-only browse projection backing the
 * Mercury /contacts list surface. Validation is the same Zod schema the
 * dashboard imports, so query-shape drift can't happen.
 */
export const dashboardContactsRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test parity: when authDisabled, accept x-org-id header (mirrors the
  // dashboard-reports preHandler). In production, auth middleware sets
  // organizationIdFromAuth from the API key metadata.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get("/api/dashboard/contacts", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = ContactsListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    if (!app.contactStore) {
      return reply.code(503).send({ error: "Contact store not available" });
    }

    try {
      return await listContactsForBrowse(
        { orgId, query: parsed.data },
        { contactStore: app.contactStore, routeTemplates: dashboardRouteTemplates },
      );
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        return reply.code(400).send({ error: "INVALID_CURSOR" });
      }
      throw e;
    }
  });
};
