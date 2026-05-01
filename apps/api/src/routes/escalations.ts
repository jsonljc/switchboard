// ---------------------------------------------------------------------------
// Escalation Inbox Routes — Owner escalation management backend
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { ConversationStateNotFoundError } from "@switchboard/core/platform";
import { requireOrganizationScope } from "../utils/require-org.js";
import { resolveOperatorActor } from "./operator-actor.js";
import { finalizeOperatorTrace } from "./work-trace-delivery-enrichment.js";

export const escalationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/escalations — list escalations filtered by status
  app.get(
    "/",
    {
      schema: {
        description:
          "List escalations for the organization, filtered by status (default: pending).",
        tags: ["Escalations"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", default: "pending" },
            limit: { type: "number", default: 50, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { status = "pending", limit = 50 } = request.query as {
        status?: string;
        limit?: number;
      };

      const escalations = await app.prisma.handoff.findMany({
        where: {
          organizationId: orgId,
          status,
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 200),
      });

      const formatted = escalations.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        leadId: e.leadId,
        status: e.status,
        reason: e.reason,
        conversationSummary: e.conversationSummary,
        leadSnapshot: e.leadSnapshot,
        qualificationSnapshot: e.qualificationSnapshot,
        slaDeadlineAt: e.slaDeadlineAt.toISOString(),
        acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
        resolutionNote: e.resolutionNote ?? null,
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }));

      return reply.send({ escalations: formatted });
    },
  );

  // GET /api/escalations/:id — single escalation with conversation history
  app.get(
    "/:id",
    {
      schema: {
        description: "Get a single escalation with full conversation history.",
        tags: ["Escalations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };

      const handoff = await app.prisma.handoff.findUnique({
        where: { id },
      });

      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      // Extract conversation history if sessionId exists. Scope by organizationId
      // (defense-in-depth, TI-5/TI-6): even though the Handoff orgId guard above
      // already gates access, the conversation row may have a divergent or null
      // organizationId — so we re-assert the scope on the conversation lookup.
      let conversationHistory: unknown[] = [];
      if (handoff.sessionId) {
        const conversation = await app.prisma.conversationState.findFirst({
          where: { threadId: handoff.sessionId, organizationId: orgId },
        });

        if (conversation && conversation.messages) {
          // Validate that messages is an array
          if (Array.isArray(conversation.messages)) {
            conversationHistory = conversation.messages;
          }
        }
      }

      const escalation = {
        id: handoff.id,
        sessionId: handoff.sessionId,
        leadId: handoff.leadId,
        status: handoff.status,
        reason: handoff.reason,
        conversationSummary: handoff.conversationSummary,
        leadSnapshot: handoff.leadSnapshot,
        qualificationSnapshot: handoff.qualificationSnapshot,
        slaDeadlineAt: handoff.slaDeadlineAt.toISOString(),
        acknowledgedAt: handoff.acknowledgedAt?.toISOString() ?? null,
        resolutionNote: handoff.resolutionNote ?? null,
        resolvedAt: handoff.resolvedAt?.toISOString() ?? null,
        createdAt: handoff.createdAt.toISOString(),
        updatedAt: handoff.updatedAt.toISOString(),
      };

      return reply.send({ escalation, conversationHistory });
    },
  );

  // POST /api/escalations/:id/reply — owner replies and releases escalation
  app.post(
    "/:id/reply",
    {
      schema: {
        description:
          "Owner replies to escalation, updates status to released, and resumes conversation.",
        tags: ["Escalations"],
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const { message } = request.body as { message: string };

      if (!message || typeof message !== "string") {
        return reply.code(400).send({ error: "Message is required", statusCode: 400 });
      }

      const handoff = await app.prisma.handoff.findUnique({
        where: { id },
      });

      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      // Update handoff status to released. The handoff mutation is owned by
      // the escalations route directly — only the conversationState-side work
      // (message append + status transition + WorkTrace) is delegated to
      // ConversationStateStore.
      const updatedHandoff = await app.prisma.handoff.update({
        where: { id },
        data: {
          status: "released",
          acknowledgedAt: new Date(),
        },
      });

      const escalation = {
        id: updatedHandoff.id,
        sessionId: updatedHandoff.sessionId,
        leadId: updatedHandoff.leadId,
        status: updatedHandoff.status,
        reason: updatedHandoff.reason,
        conversationSummary: updatedHandoff.conversationSummary,
        leadSnapshot: updatedHandoff.leadSnapshot,
        qualificationSnapshot: updatedHandoff.qualificationSnapshot,
        slaDeadlineAt: updatedHandoff.slaDeadlineAt.toISOString(),
        acknowledgedAt: updatedHandoff.acknowledgedAt?.toISOString() ?? null,
        createdAt: updatedHandoff.createdAt.toISOString(),
        updatedAt: updatedHandoff.updatedAt.toISOString(),
      };

      // No session means no conversation to release back to AI. Skip the
      // store call (and channel delivery) and return 502 — same shape as
      // before for compatibility.
      if (!handoff.sessionId) {
        return reply.code(502).send({
          escalation,
          replySent: false,
          error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
          statusCode: 502,
        });
      }

      if (!app.conversationStateStore || !app.workTraceStore) {
        return reply.code(503).send({ error: "Conversation store unavailable", statusCode: 503 });
      }

      let storeResult;
      try {
        storeResult = await app.conversationStateStore.releaseEscalationToAi({
          organizationId: orgId,
          handoffId: handoff.id,
          threadId: handoff.sessionId,
          operator: resolveOperatorActor(request),
          reply: { text: message },
        });
      } catch (err) {
        if (err instanceof ConversationStateNotFoundError) {
          return reply
            .code(404)
            .send({ error: "Conversation not found for escalation", statusCode: 404 });
        }
        throw err;
      }

      const executionStartedAt = new Date();
      let deliveryAttempted = false;
      let deliveryResult = "no_notifier";
      if (app.agentNotifier) {
        deliveryAttempted = true;
        try {
          await app.agentNotifier.sendProactive(
            storeResult.destinationPrincipalId,
            storeResult.channel,
            message,
          );
          deliveryResult = "delivered";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[escalations] Channel delivery failed for ${handoff.sessionId}: ${msg}`);
          deliveryResult = `failed: ${msg}`;
        }
      }

      await finalizeOperatorTrace(app.workTraceStore, storeResult.workTraceId, {
        deliveryAttempted,
        deliveryResult,
        executionStartedAt,
        completedAt: new Date(),
        caller: "escalations.reply",
      });

      if (deliveryResult !== "delivered") {
        return reply.code(502).send({
          escalation,
          replySent: false,
          error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
          statusCode: 502,
        });
      }

      return reply.send({ escalation, replySent: true });
    },
  );

  // POST /api/escalations/:id/resolve — mark escalation resolved with optional note
  app.post(
    "/:id/resolve",
    {
      schema: {
        description: "Mark an escalation as resolved with an optional internal note.",
        tags: ["Escalations"],
        body: {
          type: "object",
          properties: {
            resolutionNote: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const { resolutionNote } = (request.body as { resolutionNote?: string }) ?? {};

      const handoff = await app.prisma.handoff.findUnique({ where: { id } });

      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      const updatedHandoff = await app.prisma.handoff.update({
        where: { id },
        data: {
          status: "resolved",
          resolutionNote: resolutionNote ?? null,
          resolvedAt: new Date(),
        },
      });

      return reply.send({
        escalation: {
          id: updatedHandoff.id,
          sessionId: updatedHandoff.sessionId,
          leadId: updatedHandoff.leadId,
          status: updatedHandoff.status,
          reason: updatedHandoff.reason,
          resolutionNote: updatedHandoff.resolutionNote,
          resolvedAt: updatedHandoff.resolvedAt?.toISOString() ?? null,
          slaDeadlineAt: updatedHandoff.slaDeadlineAt.toISOString(),
          createdAt: updatedHandoff.createdAt.toISOString(),
          updatedAt: updatedHandoff.updatedAt.toISOString(),
        },
      });
    },
  );
};
