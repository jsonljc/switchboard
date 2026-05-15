import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunityStageSchema } from "@switchboard/schemas";
import {
  listOpportunitiesForBoard,
  transitionOpportunityStage,
  OpportunityNotFoundError,
} from "@switchboard/core/lifecycle";
import { requireOrganizationScope } from "../utils/require-org.js";

const StageTransitionRequestSchema = z.object({
  stage: OpportunityStageSchema,
});

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

  app.patch("/api/dashboard/opportunities/:id/stage", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    const parsed = StageTransitionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY" });
    }
    const { id } = request.params as { id: string };
    const principalId = request.principalIdFromAuth ?? "unknown";
    try {
      return await transitionOpportunityStage(
        { orgId, id, stage: parsed.data.stage, actor: { id: principalId, type: "user" } },
        { opportunityStore: app.opportunityStore },
      );
    } catch (err) {
      if (err instanceof OpportunityNotFoundError) {
        return reply.code(404).send({ error: "OPPORTUNITY_NOT_FOUND" });
      }
      throw err;
    }
  });
};
