import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const conversationsQuerySchema = z.object({
  status: z.string().optional(),
  channel: z.string().optional(),
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
};
