// @route-class: operator-direct
import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { matchesAny, NeedsClarificationError, NotFoundError } from "@switchboard/core";
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import { ProposeBodySchema, BatchProposeBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { createApprovalForWorkUnit } from "./approval-factory.js";
import { classifySuccessOutcome } from "./action-outcome.js";

const proposeJsonSchema = zodToJsonSchema(ProposeBodySchema, { target: "openApi3" });
const batchJsonSchema = zodToJsonSchema(BatchProposeBodySchema, { target: "openApi3" });

export const actionsRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test org binding from x-org-id / x-principal-id headers. No-op in production
  // (the real auth middleware has already populated organizationIdFromAuth).
  app.addHook("preHandler", buildDevAuthFallback(app));

  // POST /api/actions/propose - Create a new action proposal via PlatformIngress
  app.post(
    "/propose",
    {
      preHandler: requireOrgForMutation,
      schema: {
        description:
          "Create a new action proposal through PlatformIngress. Requires Idempotency-Key header.",
        tags: ["Actions"],
        body: proposeJsonSchema,
        headers: {
          type: "object",
          properties: {
            "Idempotency-Key": { type: "string", description: "Required for replay protection" },
          },
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = ProposeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }
      const body = parsed.data;

      // Skin tool filter enforcement
      const skin = app.resolvedSkin;
      if (skin) {
        const { include, exclude } = skin.toolFilter;
        const included = matchesAny(body.actionType, include);
        const excluded = exclude ? matchesAny(body.actionType, exclude) : false;
        if (!included || excluded) {
          return reply.code(403).send({
            error: `Action "${body.actionType}" is not available in the current skin configuration`,
            statusCode: 403,
          });
        }
      }

      const submitRequest: CanonicalSubmitRequest = {
        intent: body.actionType,
        parameters: body.message ? { ...body.parameters, _message: body.message } : body.parameters,
        actor: { id: body.principalId, type: "user" as const },
        organizationId: request.orgId,
        trigger: "api" as const,
        idempotencyKey,
        surface: {
          surface: "api" as const,
          requestId: request.id,
        },
        targetHint: {
          skillSlug: body.actionType.split(".")[0],
        },
      };

      try {
        const response = await app.platformIngress.submit(submitRequest);

        if (!response.ok) {
          const notFound =
            response.error.type === "intent_not_found" ||
            response.error.type === "deployment_not_found";
          const status = notFound ? 404 : 400;
          return reply.code(status).send({
            error: response.error.message,
            statusCode: status,
          });
        }

        const { result, workUnit } = response;

        if ("approvalRequired" in response && response.approvalRequired) {
          const { workUnit } = response;

          // Prefer lifecycle path when lifecycleId is present (atomically created inside ingress)
          if (
            "lifecycleId" in response &&
            "bindingHash" in response &&
            response.lifecycleId &&
            response.bindingHash
          ) {
            return reply.code(201).send({
              outcome: "PENDING_APPROVAL",
              workUnitId: workUnit.id,
              traceId: workUnit.traceId,
              approvalRequest: { id: response.lifecycleId, bindingHash: response.bindingHash },
            });
          }

          // Legacy fallback — lifecycle service not wired, use route-owned approval creation
          try {
            const { approvalId, bindingHash } = await createApprovalForWorkUnit({
              workUnit,
              storageContext: app.storageContext,
              routingConfig: app.approvalRoutingConfig,
            });

            return reply.code(201).send({
              outcome: "PENDING_APPROVAL",
              workUnitId: workUnit.id,
              traceId: workUnit.traceId,
              approvalRequest: { id: approvalId, bindingHash },
            });
          } catch (err) {
            console.error("[propose] Failed to persist approval state:", err);
            return reply.code(500).send({
              error: "Failed to persist approval state",
              statusCode: 500,
            });
          }
        }

        const EXECUTION_ERROR_CODES = ["CARTRIDGE_ERROR", "EXECUTION_ERROR", "GOVERNANCE_ERROR"];
        if (result.outcome === "failed") {
          const isExecutionFailure =
            !result.error?.code || EXECUTION_ERROR_CODES.includes(result.error.code);

          if (isExecutionFailure) {
            return reply.code(201).send({
              outcome: "FAILED",
              workUnitId: workUnit.id,
              traceId: workUnit.traceId,
              error: result.error,
            });
          }

          return reply.code(201).send({
            outcome: "DENIED",
            workUnitId: workUnit.id,
            traceId: workUnit.traceId,
            denied: true,
            explanation: result.summary,
          });
        }

        // Assert success explicitly. A "queued" outcome (workflow-mode defers to async)
        // is NOT a completed synchronous mutation, so it must not read as EXECUTED.
        const successLabel = classifySuccessOutcome(result.outcome);
        if (successLabel === "QUEUED") {
          return reply.code(202).send({
            outcome: "QUEUED",
            workUnitId: workUnit.id,
            traceId: workUnit.traceId,
          });
        }
        if (successLabel === "ERROR") {
          return reply.code(500).send({
            outcome: "ERROR",
            workUnitId: workUnit.id,
            traceId: workUnit.traceId,
            error: { code: "UNEXPECTED_OUTCOME", message: `Unexpected outcome: ${result.outcome}` },
          });
        }

        return reply.code(201).send({
          outcome: "EXECUTED",
          workUnitId: workUnit.id,
          traceId: workUnit.traceId,
          executionResult: result.outputs,
          denied: false,
        });
      } catch (err) {
        if (err instanceof NeedsClarificationError) {
          return reply.code(422).send({
            status: "needs_clarification",
            question: err.question,
            statusCode: 422,
          });
        }
        if (err instanceof NotFoundError) {
          return reply.code(404).send({
            status: "not_found",
            explanation: err.explanation,
            statusCode: 404,
          });
        }
        return reply.code(500).send({
          error: sanitizeErrorMessage(err, 500),
          statusCode: 500,
        });
      }
    },
  );

  // GET /api/actions/:id - Get action/envelope by ID
  app.get(
    "/:id",
    {
      schema: {
        description: "Get an action envelope by ID.",
        tags: ["Actions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const envelope = await app.storageContext.envelopes.getById(id);
      if (!envelope) {
        return reply.code(404).send({ error: "Envelope not found", statusCode: 404 });
      }

      const envelopeOrgId = envelope.proposals[0]?.parameters["_organizationId"] as
        | string
        | null
        | undefined;
      if (!assertOrgAccess(request, envelopeOrgId, reply)) return;

      return reply.code(200).send({ envelope });
    },
  );

  // NOTE: POST /:id/execute and POST /:id/undo moved to action-lifecycle.ts
  // (route-class: lifecycle). They are id-addressed transitions on an existing
  // work unit, not operator-direct ingress — see #654.

  // POST /api/actions/batch - Create a batch of actions with a plan
  app.post(
    "/batch",
    {
      preHandler: requireOrgForMutation,
      schema: {
        description:
          "Submit multiple action proposals as independent WorkUnits via PlatformIngress.",
        tags: ["Actions"],
        body: batchJsonSchema,
        headers: {
          type: "object",
          properties: {
            "Idempotency-Key": {
              type: "string",
              description: "Required batch-level key. Per-proposal keys derived as {key}:{index}.",
            },
          },
        },
      },
    },
    async (request, reply) => {
      const batchKey = requireIdempotencyKey(request, reply);
      if (!batchKey) return;

      const parsed = BatchProposeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }
      const body = parsed.data;

      // Skin tool filter enforcement — reject entire batch if any proposal is disallowed
      const batchSkin = app.resolvedSkin;
      if (batchSkin) {
        const { include, exclude } = batchSkin.toolFilter;
        for (const proposal of body.proposals) {
          const included = matchesAny(proposal.actionType, include);
          const excluded = exclude ? matchesAny(proposal.actionType, exclude) : false;
          if (!included || excluded) {
            return reply.code(403).send({
              error: `Action "${proposal.actionType}" is not available in the current skin configuration`,
              statusCode: 403,
            });
          }
        }
      }

      const results = [];
      for (let i = 0; i < body.proposals.length; i++) {
        const proposal = body.proposals[i]!;

        const submitRequest: CanonicalSubmitRequest = {
          intent: proposal.actionType,
          parameters: proposal.parameters,
          actor: { id: body.principalId, type: "user" as const },
          organizationId: request.orgId,
          trigger: "api" as const,
          idempotencyKey: `${batchKey}:${i}`,
          surface: {
            surface: "api" as const,
            requestId: request.id,
          },
          targetHint: {
            skillSlug: proposal.actionType.split(".")[0],
          },
        };

        try {
          const response = await app.platformIngress.submit(submitRequest);

          if (!response.ok) {
            results.push({
              index: i,
              outcome: "ERROR",
              error: response.error.message,
            });
            continue;
          }

          const { result, workUnit } = response;

          // Check if approval is required
          if ("approvalRequired" in response && response.approvalRequired) {
            results.push({
              index: i,
              outcome: "PENDING_APPROVAL",
              envelopeId: workUnit.id,
              traceId: workUnit.traceId,
            });
            continue;
          }

          // Assert success explicitly (see classifySuccessOutcome): "failed" -> DENIED,
          // "completed" -> EXECUTED, "queued" -> QUEUED, anything else -> ERROR. Never
          // let a deferred "queued" job read as a completed synchronous EXECUTED.
          results.push({
            index: i,
            outcome:
              result.outcome === "failed" ? "DENIED" : classifySuccessOutcome(result.outcome),
            envelopeId: workUnit.id,
            traceId: workUnit.traceId,
            summary: result.summary,
          });
        } catch (err) {
          results.push({
            index: i,
            outcome: "ERROR",
            error: sanitizeErrorMessage(err, 500),
          });
        }
      }

      return reply.code(201).send({ results });
    },
  );
};
