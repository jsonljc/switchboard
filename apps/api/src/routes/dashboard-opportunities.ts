import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunityStageSchema, type PipelineBoardOpportunity } from "@switchboard/schemas";
import { listOpportunitiesForBoard } from "@switchboard/core/lifecycle";
import { requireOrganizationScope } from "../utils/require-org.js";
import { getIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { TRANSITION_OPPORTUNITY_STAGE_INTENT } from "../bootstrap/operator-intents.js";

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
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available" });
    }
    const parsed = StageTransitionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY" });
    }
    const { id } = request.params as { id: string };
    const principalId = request.principalIdFromAuth ?? "unknown";
    const idempotencyKey = getIdempotencyKey(request);

    const response = await app.platformIngress.submit({
      organizationId: orgId,
      actor: { id: principalId, type: "user" },
      intent: TRANSITION_OPPORTUNITY_STAGE_INTENT,
      parameters: { id, stage: parsed.data.stage },
      trigger: "api",
      surface: { surface: "api" },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    if (!response.ok) {
      return ingressErrorToReply(response.error, reply);
    }

    const { result } = response;
    if (result.outcome === "failed") {
      if (result.error?.code === "OPPORTUNITY_NOT_FOUND") {
        return reply.code(404).send({ error: "OPPORTUNITY_NOT_FOUND" });
      }
      return reply.code(500).send({ error: result.error?.code ?? "EXECUTION_FAILED" });
    }

    const opportunity = (result.outputs as { opportunity?: PipelineBoardOpportunity }).opportunity;
    if (!opportunity) {
      return reply.code(500).send({ error: "MISSING_OUTPUT" });
    }
    return { opportunity };
  });
};
