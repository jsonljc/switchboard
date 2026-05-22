// @route-class: operator-direct
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { OpportunityStageSchema, type PipelineBoardOpportunity } from "@switchboard/schemas";
import { listOpportunitiesForBoard } from "@switchboard/core/lifecycle";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { replyValidationError } from "../utils/validation-error.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
import {
  TRANSITION_OPPORTUNITY_STAGE_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

const StageTransitionRequestSchema = z.object({
  stage: OpportunityStageSchema,
});

export const dashboardOpportunitiesRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test mode (authDisabled): populate organizationIdFromAuth + principalIdFromAuth
  // from x-org-id / x-principal-id headers (or fall back to "default"). In production
  // this hook is a no-op; the real auth middleware has already populated the fields.
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.get("/api/dashboard/opportunities", { preHandler: requireOrg }, async (request, reply) => {
    if (!app.opportunityStore) {
      return reply.code(503).send({ error: "Opportunity store not available" });
    }
    const { orgId } = request;
    return await listOpportunitiesForBoard({ orgId }, { opportunityStore: app.opportunityStore });
  });

  app.patch(
    "/api/dashboard/opportunities/:id/stage",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.opportunityStore) {
        return reply.code(503).send({ error: "Opportunity store not available" });
      }
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available" });
      }

      const parsed = StageTransitionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return replyValidationError(reply, parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const { orgId, actorId } = request;
      const { id } = request.params as { id: string };

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: TRANSITION_OPPORTUNITY_STAGE_INTENT,
        parameters: { id, stage: parsed.data.stage },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        if (result.error?.code === OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND) {
          return reply.code(404).send({ error: OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND });
        }
        // Any other handler failure is an unexpected execution error. Throw so
        // the global error handler returns a scrubbed 500 — don't echo internal
        // error codes to the client.
        throw new Error(result.error?.message ?? "Operator mutation execution failed");
      }

      const opportunity = (result.outputs as { opportunity?: PipelineBoardOpportunity })
        .opportunity;
      if (!opportunity) {
        throw new Error("Operator mutation handler returned no opportunity output");
      }
      return { opportunity };
    },
  );
};
