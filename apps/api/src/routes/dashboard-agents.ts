// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { AGENT_REGISTRY, AGENT_KEYS } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const dashboardAgentsRoutes: FastifyPluginAsync = async (app) => {
  if (!app.orgAgentEnablementStore) {
    app.log.warn("[dashboard-agents] route registered without store; will 503 on every request");
  }

  // Dev/test mode (authDisabled): allow `x-org-id` header to set the org scope so
  // the same handler can serve multi-tenant tests without an auth middleware. Falls
  // back to "default" to match the convention used by the recommendations route.
  // In production (authDisabled === false) the auth middleware sets organizationIdFromAuth
  // from API_KEY_METADATA — this hook does not run in that path because authDisabled is false.
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
        description: "List enabled + coming-soon agents for the current org.",
        tags: ["Dashboard"],
      },
    },
    async (request, reply) => {
      if (!app.orgAgentEnablementStore) {
        return reply
          .code(503)
          .send({ error: "OrgAgentEnablement store unavailable", statusCode: 503 });
      }
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const rows = await app.orgAgentEnablementStore.list(orgId);
      const byKey = new Map(rows.map((r) => [r.agentKey, r]));

      const agents = AGENT_KEYS.map((key) => {
        const meta = AGENT_REGISTRY[key];
        const row = byKey.get(key);
        return {
          key,
          slug: meta.slug,
          role: meta.role,
          displayName: meta.displayName,
          accent: meta.accent,
          launchTier: meta.launchTier,
          status: row?.status ?? "coming_soon",
          enabledAt: row?.enabledAt?.toISOString() ?? null,
        };
      });
      return reply.code(200).send({ agents });
    },
  );
};
