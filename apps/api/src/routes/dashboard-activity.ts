import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CursorDecodeError, listAuditEntriesForBrowse } from "@switchboard/core";

/**
 * GET /api/dashboard/activity — browse audit entries for the authenticated org.
 *
 * Backed by listAuditEntriesForBrowse (§4.3 of the spec). The `custom` scope value
 * is server-derived; clients may only send `operational` or `all` — the JSON Schema
 * enum here intentionally excludes `custom` to reject client spoofing.
 */
export const dashboardActivityRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test parity: when authDisabled, accept x-org-id header so the same
  // handler can serve multi-tenant tests without an auth middleware.
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

  app.get(
    "/",
    {
      schema: {
        description: "Browse audit entries for the authenticated org.",
        tags: ["Dashboard", "Activity"],
        querystring: {
          type: "object",
          properties: {
            // Note: clients pick `operational` or `all`; `custom` is server-derived.
            // Including `custom` in this enum would let clients spoof it; reject as invalid.
            scope: { type: "string", enum: ["operational", "all"] },
            cursor: { type: "string" },
            // limit arrives as a string from URL params; Zod coerces in core (§4.3).
            limit: { type: "integer", minimum: 1, maximum: 100 },
            eventType: { type: "string" },
            actorType: {
              type: "string",
              enum: ["user", "agent", "service_account", "system"],
            },
            entityType: { type: "string" },
            entityId: { type: "string" },
            after: { type: "string", format: "date-time" },
            before: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request, reply) => {
      const orgId = request.organizationIdFromAuth;
      if (!orgId) return reply.code(401).send({ error: "Org context required" });

      try {
        const result = await listAuditEntriesForBrowse(app.auditLedger, orgId, request.query);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof CursorDecodeError) {
          return reply.code(400).send({ error: "Malformed cursor" });
        }
        if (err instanceof z.ZodError) {
          return reply.code(400).send({ error: "Invalid query", details: err.flatten() });
        }
        request.log.error({ err }, "dashboard-activity list failed");
        return reply.code(500).send({ error: "Internal error" });
      }
    },
  );
};
