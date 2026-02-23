import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { NeedsClarificationError, NotFoundError } from "@switchboard/core";
import { ExecuteBodySchema } from "../validation.js";

const executeJsonSchema = zodToJsonSchema(ExecuteBodySchema, { target: "openApi3" });

export const executeRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/execute - Single endpoint: propose + conditional execute, returns EXECUTED | PENDING_APPROVAL | DENIED
  app.post("/execute", {
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
  }, async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"];
    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      return reply.code(400).send({
        error: "Idempotency-Key header is required for POST /api/execute (replay protection)",
        statusCode: 400,
      });
    }

    const parsed = ExecuteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

    // Phase 2: when API key has org metadata, bind request to that org if body does not set it
    const organizationId = body.organizationId ?? request.organizationIdFromAuth ?? null;
    const requestPayload = {
      actorId: body.actorId,
      organizationId,
      requestedAction: body.action,
      entityRefs: body.entityRefs,
      message: body.message,
      traceId: body.traceId,
    };

    try {
      const result = await app.executionService.execute(requestPayload);

      if (result.outcome === "DENIED") {
        return reply.code(200).send({
          outcome: result.outcome,
          envelopeId: result.envelopeId,
          traceId: result.traceId,
          deniedExplanation: result.deniedExplanation,
        });
      }

      if (result.outcome === "PENDING_APPROVAL") {
        return reply.code(200).send({
          outcome: result.outcome,
          envelopeId: result.envelopeId,
          traceId: result.traceId,
          approvalId: result.approvalId,
          approvalRequest: result.approvalRequest,
        });
      }

      return reply.code(200).send({
        outcome: result.outcome,
        envelopeId: result.envelopeId,
        traceId: result.traceId,
        executionResult: result.executionResult,
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
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
