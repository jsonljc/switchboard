import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const conversationsQuerySchema = z.object({
  status: z.string().optional(),
  channel: z.string().optional(),
  principalId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const conversationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/conversations — list conversations with filters
  app.get(
    "/",
    {
      schema: {
        description: "List conversations with optional status/channel filters.",
        tags: ["Conversations"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

      const parsed = conversationsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.format() });
      }

      const limit = parsed.data.limit ?? 50;
      const offset = parsed.data.offset ?? 0;

      const where: Record<string, unknown> = {};
      if (parsed.data.status) where["status"] = parsed.data.status;
      if (parsed.data.channel) where["channel"] = parsed.data.channel;
      if (parsed.data.principalId) where["principalId"] = parsed.data.principalId;
      if (request.organizationIdFromAuth) where["organizationId"] = request.organizationIdFromAuth;

      const [rows, total] = await Promise.all([
        prisma.conversationState.findMany({
          where,
          orderBy: { lastActivityAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.conversationState.count({ where }),
      ]);

      const conversations = rows.map(
        (row: {
          id: string;
          threadId: string;
          channel: string;
          principalId: string;
          status: string;
          currentIntent: string | null;
          firstReplyAt: Date | null;
          lastActivityAt: Date;
        }) => ({
          id: row.id,
          threadId: row.threadId,
          channel: row.channel,
          principalId: row.principalId,
          organizationId: (row as { organizationId?: string | null }).organizationId ?? null,
          status: row.status,
          currentIntent: row.currentIntent,
          firstReplyAt: row.firstReplyAt?.toISOString() ?? null,
          lastActivityAt: row.lastActivityAt.toISOString(),
        }),
      );

      return reply.send({
        conversations,
        total,
        limit,
        offset,
      });
    },
  );

  app.get(
    "/:id",
    {
      schema: {
        description: "Get a single conversation by ID.",
        tags: ["Conversations"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

      const { id } = request.params as { id: string };
      const where: Record<string, unknown> = { id };
      if (request.organizationIdFromAuth) {
        where["organizationId"] = request.organizationIdFromAuth;
      }

      const row = await prisma.conversationState.findFirst({ where });
      if (!row) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const messages =
        typeof row.messages === "string"
          ? safeParseMessages(row.messages)
          : Array.isArray(row.messages)
            ? row.messages
            : [];

      return reply.send({
        id: row.id,
        threadId: row.threadId,
        channel: row.channel,
        principalId: row.principalId,
        organizationId: row.organizationId,
        status: row.status,
        currentIntent: row.currentIntent,
        firstReplyAt: row.firstReplyAt?.toISOString() ?? null,
        lastActivityAt: row.lastActivityAt.toISOString(),
        messages,
      });
    },
  );

  app.patch(
    "/:id/override",
    {
      schema: {
        description: "Toggle human override for a conversation.",
        tags: ["Conversations"],
      },
    },
    async (request, reply) => {
      const prisma = app.prisma;
      if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

      const { id } = request.params as { id: string };
      const body = request.body as { override?: boolean };
      const where: Record<string, unknown> = { id };
      if (request.organizationIdFromAuth) {
        where["organizationId"] = request.organizationIdFromAuth;
      }

      const existing = await prisma.conversationState.findFirst({ where });
      if (!existing) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const status = body.override === false ? "active" : "human_override";
      const updated = await prisma.conversationState.update({
        where: { id: existing.id },
        data: { status, lastActivityAt: new Date() },
      });

      return reply.send({ id: updated.id, status: updated.status });
    },
  );
};

function safeParseMessages(raw: string): Array<{ role: string; text: string; timestamp: string }> {
  try {
    const parsed = JSON.parse(raw) as Array<{ role: string; text: string; timestamp: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
