// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { ScheduledTriggersListQuerySchema } from "@switchboard/schemas";
import { listTriggersForBrowse, InvalidCursorError } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

/**
 * GET /api/dashboard/automations — read-only browse projection backing the
 * Mercury /automations list surface (D2). Validation is the same Zod schema
 * the dashboard imports, so query-shape drift can't happen.
 */
export const dashboardAutomationsRoutes: FastifyPluginAsync = async (app) => {
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

  app.get("/api/dashboard/automations", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = ScheduledTriggersListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    if (!app.triggerStore) {
      return reply.code(503).send({ error: "Trigger store not available" });
    }

    try {
      return await listTriggersForBrowse(
        { orgId, query: parsed.data },
        { triggerStore: app.triggerStore },
      );
    } catch (e) {
      if (e instanceof InvalidCursorError) {
        return reply.code(400).send({ error: "INVALID_CURSOR" });
      }
      throw e;
    }
  });
};
