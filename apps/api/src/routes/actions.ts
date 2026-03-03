import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { inferCartridgeId, matchesAny } from "@switchboard/core";
import { ProposeBodySchema, BatchProposeBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";

const proposeJsonSchema = zodToJsonSchema(ProposeBodySchema, { target: "openApi3" });
const batchJsonSchema = zodToJsonSchema(BatchProposeBodySchema, { target: "openApi3" });

export const actionsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/actions/propose - Create a new action proposal via envelope
  app.post(
    "/propose",
    {
      schema: {
        description:
          "Create a new action proposal. Evaluates policies, risk scoring, and approval requirements.",
        tags: ["Actions"],
        body: proposeJsonSchema,
      },
    },
    async (request, reply) => {
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

      const cartridgeId = body.cartridgeId ?? inferCartridgeId(body.actionType);
      if (!cartridgeId) {
        return reply.code(400).send({ error: "Cannot infer cartridgeId from actionType" });
      }

      try {
        const result = await app.orchestrator.resolveAndPropose({
          actionType: body.actionType,
          parameters: body.parameters,
          principalId: body.principalId,
          organizationId: request.organizationIdFromAuth ?? body.organizationId ?? null,
          cartridgeId,
          entityRefs: body.entityRefs ?? [],
          message: body.message,
        });

        if ("needsClarification" in result) {
          return reply.code(422).send({
            status: "needs_clarification",
            question: result.question,
          });
        }

        if ("notFound" in result) {
          return reply.code(404).send({
            status: "not_found",
            explanation: result.explanation,
          });
        }

        return reply.code(201).send({
          envelope: result.envelope,
          decisionTrace: result.decisionTrace,
          approvalRequest: result.approvalRequest,
          denied: result.denied,
          explanation: result.explanation,
        });
      } catch (err) {
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
        description: "Submit multiple action proposals in a single batch.",
        tags: ["Actions"],
        body: batchJsonSchema,
      },
    },
    async (request, reply) => {
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

      const results = [];
      for (const proposal of body.proposals) {
        const cartridgeId = body.cartridgeId ?? inferCartridgeId(proposal.actionType);
        if (!cartridgeId) continue;

        try {
          const result = await app.orchestrator.resolveAndPropose({
            actionType: proposal.actionType,
            parameters: proposal.parameters,
            principalId: body.principalId,
            organizationId: request.organizationIdFromAuth ?? body.organizationId ?? null,
            cartridgeId,
            entityRefs: [],
          });
          results.push(result);
        } catch (err) {
          results.push({ error: sanitizeErrorMessage(err, 500) });
        }
      }

      return reply.code(201).send({ results });
    },
  );
};
