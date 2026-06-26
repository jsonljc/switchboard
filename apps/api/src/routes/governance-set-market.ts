// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Governance market route (P2-B slice 2b). A thin translator that submits the governed
// `governance.set_market` operator-mutation intent through PlatformIngress, setting the
// org's market (jurisdiction + clinicType) on its Alex deployment. The deployment is
// resolved SERVER-SIDE by skillSlug ("alex") — a client-supplied deploymentId is never
// trusted — so the market lands on the lead-serving deployment that slice-1's currency
// derivation reads (closing the cross-slice seam) and a caller cannot target another of
// the org's deployments. Maps the FULL SubmitWorkResponse (ok AND outcome) to a status;
// `ok` alone is never treated as success.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { JurisdictionSchema, ClinicTypeSchema } from "@switchboard/schemas";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { requireOrgForMutation } from "../decorators/org.js";
import {
  GOVERNANCE_SET_MARKET_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

interface MarketOutcome {
  outcome: string;
  error?: { code: string; message: string };
  outputs?: Record<string, unknown>;
}

/**
 * Maps the executed intent's result to an HTTP reply. ONLY `outcome === "completed"`
 * is success; every "failed" outcome maps to a 4xx by its error code, and any other
 * outcome (or an unmapped failure) throws so the global handler returns a scrubbed 500.
 * Pure + exported so the full-response contract is unit-tested.
 */
export function marketResultToReply(result: MarketOutcome): {
  code: number;
  body: Record<string, unknown>;
} {
  if (result.outcome === "completed") {
    const outputs = (result.outputs ?? {}) as { jurisdiction?: string; clinicType?: string };
    return {
      code: 200,
      body: { jurisdiction: outputs.jurisdiction, clinicType: outputs.clinicType },
    };
  }

  const code = result.error?.code;
  if (code === OPERATOR_INTENT_ERROR_CODES.DEPLOYMENT_NOT_FOUND) {
    return { code: 404, body: { error: "deployment_not_found", statusCode: 404 } };
  }
  if (code === OPERATOR_INTENT_ERROR_CODES.GOVERNANCE_CONFIG_INVALID) {
    return {
      code: 409,
      body: { error: "governance_config_invalid", reason: result.error?.message, statusCode: 409 },
    };
  }
  // Unexpected outcome / unmapped failure (e.g. an impossible pending_approval for a
  // system_auto_approved intent): throw so the global error handler scrubs it to a 500.
  throw new Error(result.error?.message ?? "governance.set_market failed");
}

export const governanceMarketRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/:agentId/governance/market",
    {
      preHandler: requireOrgForMutation,
      schema: {
        description: "Set this org's market (jurisdiction + clinicType) on its Alex deployment.",
        tags: ["Governance"],
        params: {
          type: "object",
          properties: { agentId: { type: "string" } },
          required: ["agentId"],
        },
        body: {
          type: "object",
          required: ["jurisdiction", "clinicType"],
          properties: { jurisdiction: { type: "string" }, clinicType: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { orgId, actorId } = request;

      const reqBody = request.body as { jurisdiction?: string; clinicType?: string } | undefined;
      const jurisdiction = JurisdictionSchema.safeParse(reqBody?.jurisdiction);
      if (!jurisdiction.success) {
        return reply.code(400).send({ error: "invalid jurisdiction", statusCode: 400 });
      }
      const clinicType = ClinicTypeSchema.safeParse(reqBody?.clinicType);
      if (!clinicType.success) {
        return reply.code(400).send({ error: "invalid clinicType", statusCode: 400 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const prisma = app.prisma;
      const deployment = await prisma.agentDeployment.findFirst({
        where: { organizationId: orgId, skillSlug: "alex" },
        select: { id: true },
      });
      if (!deployment) {
        return reply
          .code(404)
          .send({ error: "No Alex deployment for this organization", statusCode: 404 });
      }

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: GOVERNANCE_SET_MARKET_INTENT,
        // deploymentId is the SERVER-resolved Alex deployment, never a client param.
        parameters: {
          deploymentId: deployment.id,
          jurisdiction: jurisdiction.data,
          clinicType: clinicType.data,
        },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      const { code, body } = marketResultToReply(response.result);
      return reply.code(code).send(body);
    },
  );
};
