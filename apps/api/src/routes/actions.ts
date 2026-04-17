import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { matchesAny, NeedsClarificationError, NotFoundError } from "@switchboard/core";
import type { SubmitWorkRequest } from "@switchboard/core/platform";
import { ProposeBodySchema, BatchProposeBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";

const proposeJsonSchema = zodToJsonSchema(ProposeBodySchema, { target: "openApi3" });
const batchJsonSchema = zodToJsonSchema(BatchProposeBodySchema, { target: "openApi3" });

export const actionsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/actions/propose - Create a new action proposal via PlatformIngress
  app.post(
    "/propose",
    {
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
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        return reply.code(400).send({
          error: "Idempotency-Key header is required for POST /api/actions/propose",
          statusCode: 400,
        });
      }

      const parsed = ProposeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues });
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

      const organizationId = request.organizationIdFromAuth ?? body.organizationId ?? null;
      if (!organizationId) {
        return reply.code(400).send({
          error: "organizationId is required (set via API key metadata or request body)",
          statusCode: 400,
        });
      }

      const submitRequest: SubmitWorkRequest = {
        intent: body.actionType,
        parameters: body.message ? { ...body.parameters, _message: body.message } : body.parameters,
        actor: { id: body.principalId, type: "user" as const },
        organizationId,
        trigger: "api" as const,
        idempotencyKey,
      };

      try {
        const response = await app.platformIngress.submit(submitRequest);

        if (!response.ok) {
          const status = response.error.type === "intent_not_found" ? 404 : 400;
          return reply.code(status).send({
            error: response.error.message,
            statusCode: status,
          });
        }

        const { result, workUnit } = response;

        if ("approvalRequired" in response && response.approvalRequired) {
          // TODO: Implement approval creation in PlatformIngress path
          // For now, return not implemented error
          return reply.code(501).send({
            error: "Approval workflow not yet implemented in PlatformIngress path",
            statusCode: 501,
          });
        }

        const EXECUTION_ERROR_CODES = ["CARTRIDGE_ERROR", "EXECUTION_ERROR", "GOVERNANCE_ERROR"];
        if (result.outcome === "failed") {
          const isExecutionFailure =
            !result.error?.code || EXECUTION_ERROR_CODES.includes(result.error.code);

          if (isExecutionFailure) {
            return reply.code(201).send({
              outcome: "FAILED",
              envelopeId: workUnit.id,
              traceId: workUnit.traceId,
              error: result.error,
            });
          }

          return reply.code(201).send({
            outcome: "DENIED",
            envelopeId: workUnit.id,
            traceId: workUnit.traceId,
            denied: true,
            explanation: result.summary,
          });
        }

        // Success path - create envelope for backward compatibility with GET endpoints
        if (result.outcome === "completed") {
          const proposal: import("@switchboard/schemas").ActionProposal = {
            id: `prop_${workUnit.id}`,
            actionType: workUnit.intent,
            parameters: {
              ...workUnit.parameters,
              _principalId: workUnit.actor.id,
              _organizationId: workUnit.organizationId,
            },
            evidence: result.summary,
            confidence: 1.0,
            originatingMessageId: "",
          };

          const executionResult: import("@switchboard/schemas").ExecutionResult = {
            actionId: proposal.id,
            envelopeId: workUnit.id,
            success: true,
            summary: result.summary,
            externalRefs: (result.outputs.externalRefs as Record<string, string>) || {},
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: result.durationMs,
            undoRecipe: null,
            executedAt: new Date(),
          };

          const now = new Date();
          const envelope: import("@switchboard/schemas").ActionEnvelope = {
            id: workUnit.id,
            version: 1,
            incomingMessage: null,
            conversationId: null,
            proposals: [proposal],
            resolvedEntities: [],
            plan: null,
            decisions: [],
            approvalRequests: [],
            executionResults: [executionResult],
            auditEntryIds: [],
            status: "executed",
            createdAt: now,
            updatedAt: now,
            parentEnvelopeId: null,
            traceId: workUnit.traceId,
          };

          try {
            await app.storageContext.envelopes.save(envelope);
          } catch (err) {
            console.error("[propose] Failed to save envelope:", err);
          }
        }

        return reply.code(201).send({
          outcome: "EXECUTED",
          envelopeId: workUnit.id,
          traceId: workUnit.traceId,
          executionResult: result.outputs,
          denied: false,
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
        return reply.code(500).send({
          error: sanitizeErrorMessage(err, 500),
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
        return reply.code(404).send({ error: "Envelope not found" });
      }

      const envelopeOrgId = envelope.proposals[0]?.parameters["_organizationId"] as
        | string
        | null
        | undefined;
      if (!assertOrgAccess(request, envelopeOrgId, reply)) return;

      return reply.code(200).send({ envelope });
    },
  );

  // POST /api/actions/:id/execute - Execute an approved envelope
  app.post(
    "/:id/execute",
    {
      schema: {
        description: "Execute a previously approved action envelope.",
        tags: ["Actions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const envelope = await app.storageContext.envelopes.getById(id);
      if (!envelope) {
        return reply.code(404).send({ error: "Envelope not found" });
      }

      const envelopeOrgId = envelope.proposals[0]?.parameters["_organizationId"] as
        | string
        | null
        | undefined;
      if (!assertOrgAccess(request, envelopeOrgId, reply)) return;

      try {
        const result = await app.orchestrator.executeApproved(id);
        return reply.code(200).send({ result });
      } catch (err) {
        return reply.code(400).send({
          error: sanitizeErrorMessage(err, 400),
        });
      }
    },
  );

  // POST /api/actions/:id/undo - Request undo for an executed action
  app.post(
    "/:id/undo",
    {
      schema: {
        description:
          "Request undo for a previously executed action. Creates a new reverse proposal.",
        tags: ["Actions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const envelope = await app.storageContext.envelopes.getById(id);
      if (!envelope) {
        return reply.code(404).send({ error: "Envelope not found" });
      }

      const envelopeOrgId = envelope.proposals[0]?.parameters["_organizationId"] as
        | string
        | null
        | undefined;
      if (!assertOrgAccess(request, envelopeOrgId, reply)) return;

      try {
        const result = await app.orchestrator.requestUndo(id);
        return reply.code(201).send({
          envelope: result.envelope,
          decisionTrace: result.decisionTrace,
          approvalRequest: result.approvalRequest,
          denied: result.denied,
          explanation: result.explanation,
        });
      } catch (err) {
        return reply.code(400).send({
          error: sanitizeErrorMessage(err, 400),
        });
      }
    },
  );

  // POST /api/actions/batch - Create a batch of actions with a plan
  app.post(
    "/batch",
    {
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
      const batchKey = request.headers["idempotency-key"];
      if (!batchKey || typeof batchKey !== "string" || !batchKey.trim()) {
        return reply.code(400).send({
          error: "Idempotency-Key header is required for POST /api/actions/batch",
          statusCode: 400,
        });
      }

      const parsed = BatchProposeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues });
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

      const organizationId = request.organizationIdFromAuth ?? body.organizationId ?? null;
      if (!organizationId) {
        return reply.code(400).send({
          error: "organizationId is required (set via API key metadata or request body)",
          statusCode: 400,
        });
      }

      const results = [];
      for (let i = 0; i < body.proposals.length; i++) {
        const proposal = body.proposals[i];

        const submitRequest: SubmitWorkRequest = {
          intent: proposal.actionType,
          parameters: proposal.parameters,
          actor: { id: body.principalId, type: "user" as const },
          organizationId,
          trigger: "api" as const,
          idempotencyKey: `${batchKey}:${i}`,
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
          results.push({
            index: i,
            outcome: result.outcome === "failed" ? "DENIED" : "EXECUTED",
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
