// @route-class: read-only
// Legacy/debug endpoint. The operator-visible surface for outcome rows is
// GET /api/dashboard/agents/riley/activity (the agent-panel work log feed);
// this route remains as the dedicated outcomes contract for debugging and
// compatibility. Both render through lib/outcome-activity-row.ts.
import type { FastifyInstance } from "fastify";
import type { ActivityRow } from "@switchboard/schemas";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";
import { requireOrganizationScope } from "../../../utils/require-org.js";
import { translateOutcomeToActivityRow } from "../../../lib/outcome-activity-row.js";

export interface OutcomesRouteDeps {
  listRenderable(args: { orgId: string; limit: number }): Promise<RecommendationOutcomeReadModel[]>;
}

const DEFAULT_LIMIT = 100;

export async function registerRileyOutcomesRoute(
  app: FastifyInstance,
  deps: OutcomesRouteDeps,
): Promise<void> {
  // Dev/test mode: allow `x-org-id` header to set the org scope.
  // In production the auth middleware sets organizationIdFromAuth before handlers run.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
    }
  });

  app.get("/api/cockpit/riley/outcomes", async (req, reply) => {
    const orgId = requireOrganizationScope(req, reply);
    if (!orgId) return;
    const rows = await deps.listRenderable({ orgId, limit: DEFAULT_LIMIT });
    return {
      rows: rows.map(translateOutcomeToActivityRow).filter((r): r is ActivityRow => r !== null),
    };
  });
}
