import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunitySchema } from "@switchboard/schemas";
import {
  listOpportunitiesForBoard,
  transitionOpportunityStage,
  OpportunityNotFoundError,
} from "@switchboard/core/lifecycle";
import { requireOrganizationScope } from "../utils/require-org.js";

const _StageTransitionRequestSchema = z.object({
  stage: OpportunitySchema.shape.stage,
});

// Re-export for Task 9's PATCH handler — prevents unused-import lint errors
// until Task 9 adds the PATCH route in this file.
export { transitionOpportunityStage, OpportunityNotFoundError };

export const dashboardOpportunitiesRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test parity: when authDisabled, accept x-org-id header (mirrors the
  // dashboard-contacts preHandler). In production, auth middleware sets
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

  app.get("/api/dashboard/opportunities", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    return await listOpportunitiesForBoard({ orgId }, { opportunityStore: app.opportunityStore });
  });

  // PATCH route added in Task 9
};
