// ---------------------------------------------------------------------------
// Handoff Routes — Human handoff inbox backend
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import type { HandoffPackage } from "@switchboard/core";
import { PrismaHandoffStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export const handoffRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/handoff/pending — list pending handoffs enriched with conversation data
  app.get(
    "/pending",
    {
      schema: {
        description: "List pending handoffs for the organization, enriched with conversation data.",
        tags: ["Handoff"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const store = new PrismaHandoffStore(prisma);
      const handoffs = await store.listPending(orgId);

      // Enrich with conversation state data
      const sessionIds = handoffs.map((h: HandoffPackage) => h.sessionId);
      const conversations = await prisma.conversationState.findMany({
        where: { threadId: { in: sessionIds } },
        select: {
          threadId: true,
          channel: true,
          status: true,
          messages: true,
          lastActivityAt: true,
        },
      });

      const conversationMap = new Map(conversations.map((c) => [c.threadId, c]));

      const enriched = handoffs.map((h: HandoffPackage) => {
        const conv = conversationMap.get(h.sessionId);
        return {
          ...h,
          slaDeadlineAt: h.slaDeadlineAt.toISOString(),
          createdAt: h.createdAt.toISOString(),
          acknowledgedAt: h.acknowledgedAt?.toISOString() ?? null,
          conversation: conv
            ? {
                channel: conv.channel,
                status: conv.status,
                lastActivityAt: conv.lastActivityAt.toISOString(),
              }
            : null,
        };
      });

      return reply.send({ handoffs: enriched });
    },
  );

  // GET /api/handoff/count — count pending handoffs (for badge)
  app.get(
    "/count",
    {
      schema: {
        description: "Count pending handoffs for badge display.",
        tags: ["Handoff"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const count = await prisma.handoff.count({
        where: {
          organizationId: orgId,
          status: { in: ["pending", "assigned", "active"] },
        },
      });

      return reply.send({ count });
    },
  );

  // POST /api/handoff/:id/release — release handoff back to AI
  app.post(
    "/:id/release",
    {
      schema: {
        description: "Release a handoff back to AI control.",
        tags: ["Handoff"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };

      // Verify handoff belongs to this org
      const handoff = await prisma.handoff.findUnique({ where: { id } });
      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Handoff not found" });
      }

      if (handoff.status === "released") {
        return reply.code(400).send({ error: "Handoff already released" });
      }

      const store = new PrismaHandoffStore(prisma);
      await store.updateStatus(id, "released");

      // Toggle the conversation back to active
      await prisma.conversationState.updateMany({
        where: { threadId: handoff.sessionId, organizationId: orgId },
        data: { status: "active", lastActivityAt: new Date() },
      });

      return reply.send({ id, status: "released" });
    },
  );
};
