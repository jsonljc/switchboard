import type { FastifyPluginAsync } from "fastify";
import { getContactDetail, ContactNotFoundError } from "@switchboard/core/contacts";
import { requireOrganizationScope } from "../utils/require-org.js";

/**
 * GET /api/dashboard/contacts/:id — read-only composite payload for the
 * Mercury /contacts/[id] detail surface. Returns 404 for missing or cross-org
 * contactId (no info leak between the two cases — `findById` is org-scoped,
 * so cross-org returns null → ContactNotFoundError → 404, same as missing).
 */
export const dashboardContactDetailRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test parity: when authDisabled, accept x-org-id header (mirrors
  // dashboard-contacts and dashboard-reports). In production, auth middleware
  // sets organizationIdFromAuth from the API key metadata.
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

  app.get<{ Params: { id: string } }>("/api/dashboard/contacts/:id", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params;

    const stores = {
      contactStore: app.contactStore,
      opportunityStore: app.opportunityStore,
      threadStore: app.threadStore,
      recommendationStore: app.recommendationStore,
      handoffStore: app.handoffStore,
      revenueEventStore: app.revenueEventStore,
    };
    const missing = Object.entries(stores)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      return reply.code(503).send({
        error: `Contact detail dependencies not wired [missing: ${missing.join(", ")}]`,
      });
    }

    try {
      return await getContactDetail(
        { orgId, contactId: id },
        {
          contactStore: stores.contactStore!,
          opportunityStore: stores.opportunityStore!,
          threadStore: stores.threadStore!,
          recommendationStore: stores.recommendationStore!,
          handoffStore: stores.handoffStore!,
          revenueEventStore: stores.revenueEventStore!,
        },
      );
    } catch (e) {
      if (e instanceof ContactNotFoundError) {
        return reply.code(404).send({ error: "CONTACT_NOT_FOUND" });
      }
      throw e;
    }
  });
};
