// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Governance per-gate flip route. A thin translator that submits the governed
// `governance.set_gate_mode` operator-mutation intent through PlatformIngress. The
// authoritative readiness REFUSE lives in the handler (server-side); this route only
// validates input, resolves the org's Alex deployment, submits, and maps the FULL
// SubmitWorkResponse (ok AND outcome) to a status — never treating ok alone as success.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { GovernanceGateUnitSchema, GovernanceModeSchema } from "@switchboard/schemas";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { requireOrgForMutation } from "../decorators/org.js";
import {
  GOVERNANCE_SET_GATE_MODE_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

interface FlipOutcome {
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
export function flipResultToReply(result: FlipOutcome): {
  code: number;
  body: Record<string, unknown>;
} {
  if (result.outcome === "completed") {
    const outputs = (result.outputs ?? {}) as { unit?: string; mode?: string };
    return { code: 200, body: { unit: outputs.unit, mode: outputs.mode } };
  }

  const code = result.error?.code;
  if (code === OPERATOR_INTENT_ERROR_CODES.GATE_NOT_ENFORCE_READY) {
    return {
      code: 409,
      body: { error: "gate_not_enforce_ready", reason: result.error?.message, statusCode: 409 },
    };
  }
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
  throw new Error(result.error?.message ?? "governance.set_gate_mode failed");
}

export const governanceFlipRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/:agentId/governance/gates/:unit/mode",
    {
      preHandler: requireOrgForMutation,
      schema: {
        description: "Flip an Alex governance gate observe <-> enforce (or off) for this org.",
        tags: ["Governance"],
        params: {
          type: "object",
          properties: { agentId: { type: "string" }, unit: { type: "string" } },
          required: ["agentId", "unit"],
        },
        body: {
          type: "object",
          required: ["mode"],
          properties: { mode: { type: "string" } },
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

      const unit = GovernanceGateUnitSchema.safeParse((request.params as { unit?: string }).unit);
      if (!unit.success) {
        return reply.code(400).send({ error: "invalid gate unit", statusCode: 400 });
      }
      const mode = GovernanceModeSchema.safeParse(
        (request.body as { mode?: string } | undefined)?.mode,
      );
      if (!mode.success) {
        return reply.code(400).send({ error: "invalid mode", statusCode: 400 });
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
        intent: GOVERNANCE_SET_GATE_MODE_INTENT,
        parameters: { deploymentId: deployment.id, unit: unit.data, mode: mode.data },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      const { code, body } = flipResultToReply(response.result);
      return reply.code(code).send(body);
    },
  );
};
