// ---------------------------------------------------------------------------
// Escalation Inbox Routes — Owner escalation management backend
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";

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

      // Extract conversation history if sessionId exists
      let conversationHistory: unknown[] = [];
      if (handoff.sessionId) {
        const conversation = await app.prisma.conversationState.findUnique({
          where: { threadId: handoff.sessionId },
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

      // Update handoff status to released
      const updatedHandoff = await app.prisma.handoff.update({
        where: { id },
        data: {
          status: "released",
          acknowledgedAt: new Date(),
        },
      });

      // If sessionId exists, append owner reply to conversation and set status to active
      if (handoff.sessionId) {
        const conversation = await app.prisma.conversationState.findUnique({
          where: { threadId: handoff.sessionId },
        });

        if (conversation) {
          const currentMessages = Array.isArray(conversation.messages) ? conversation.messages : [];

          const ownerReply = {
            role: "owner",
            text: message,
            timestamp: new Date().toISOString(),
          };

          const updatedMessages = [...currentMessages, ownerReply];

          await app.prisma.conversationState.update({
            where: { threadId: handoff.sessionId },
            data: {
              messages: updatedMessages,
              lastActivityAt: new Date(),
              status: "active",
            },
          });
        }
      }

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
