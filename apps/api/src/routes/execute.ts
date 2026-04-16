import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { NeedsClarificationError, NotFoundError, matchesAny } from "@switchboard/core";
import type { SubmitWorkRequest } from "@switchboard/core/platform";
import { ExecuteBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";

const executeJsonSchema = zodToJsonSchema(ExecuteBodySchema, { target: "openApi3" });

export const executeRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/execute - Single endpoint: propose + conditional execute, returns EXECUTED | PENDING_APPROVAL | DENIED
  app.post(
    "/execute",
    {
      schema: {
        description:
          "Execute an action through the governance spine. Evaluates policy and risk; returns EXECUTED, PENDING_APPROVAL, or DENIED with envelopeId and traceId. Requires Idempotency-Key header for replay protection.",
        tags: ["Execute"],
        body: executeJsonSchema,
        headers: {
          type: "object",
          properties: {
            "Idempotency-Key": { type: "string", description: "Required for replay protection" },
          },
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        return reply.code(400).send({
          error: "Idempotency-Key header is required for POST /api/execute (replay protection)",
          statusCode: 400,
        });
      }

      const parsed = ExecuteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues });
      }
      const body = parsed.data;

      // Skin tool filter enforcement
      const skin = app.resolvedSkin;
      if (skin) {
        const actionType = body.action.actionType;
        const { include, exclude } = skin.toolFilter;
        const included = matchesAny(actionType, include);
        const excluded = exclude ? matchesAny(actionType, exclude) : false;
        if (!included || excluded) {
          return reply.code(403).send({
            error: `Action "${actionType}" is not available in the current skin configuration`,
            statusCode: 403,
          });
        }
      }

      // Phase 2: when API key has org metadata, bind request to that org if body does not set it
      const organizationId = request.organizationIdFromAuth ?? body.organizationId ?? null;
      if (!organizationId) {
        return reply.code(400).send({
          error: "organizationId is required (set via API key metadata or request body)",
          statusCode: 400,
        });
      }

      const submitRequest: SubmitWorkRequest = {
        intent: body.action.actionType,
        parameters: body.action.parameters,
        actor: { id: body.actorId, type: "user" as const },
        organizationId,
        trigger: "api" as const,
        idempotencyKey,
        traceId: body.traceId,
      };

      try {
        const response = await app.platformIngress.submit(submitRequest);

        // Ingress rejection (intent not found, trigger not allowed)
        if (!response.ok) {
          const status = response.error.type === "intent_not_found" ? 404 : 400;
          return reply.code(status).send({
            error: response.error.message,
            statusCode: status,
          });
        }

        const { result, workUnit } = response;

        // Approval pending
        if ("approvalRequired" in response && response.approvalRequired) {
          return reply.code(200).send({
            outcome: "PENDING_APPROVAL",
            envelopeId: workUnit.id,
            traceId: workUnit.traceId,
            approvalId: result.approvalId,
            approvalRequest: result.outputs,
          });
        }

        // Governance deny (ingress-time)
        if (result.outcome === "failed" && result.error?.code) {
          // GovernanceGate sets reasonCode (e.g. "FORBIDDEN_BEHAVIOR", "GOVERNANCE_ERROR")
          return reply.code(200).send({
            outcome: "DENIED",
            envelopeId: workUnit.id,
            traceId: workUnit.traceId,
            deniedExplanation: result.summary,
          });
        }

        // Execution failure (execution-time)
        if (result.outcome === "failed") {
          return reply.code(200).send({
            outcome: "FAILED",
            envelopeId: workUnit.id,
            traceId: workUnit.traceId,
            error: result.error,
          });
        }

        // Success
        return reply.code(200).send({
          outcome: "EXECUTED",
          envelopeId: workUnit.id,
          traceId: workUnit.traceId,
          executionResult: result.outputs,
        });
      } catch (err) {
        if (err instanceof NeedsClarificationError) {
          return reply.code(422).send({
            status: "needs_clarification",
            question: err.question,
          });
        }
        if (err instanceof NotFoundError) {
          return reply.code(404).send({
            status: "not_found",
            explanation: err.explanation,
          });
        }
        if (err instanceof Error && err.message.includes("cartridgeId")) {
          return reply.code(400).send({
            error: err.message,
            actionType: body.action.actionType,
          });
        }
        return reply.code(500).send({
          error: sanitizeErrorMessage(err, 500),
        });
      }
    },
  );
};
