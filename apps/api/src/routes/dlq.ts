import type { FastifyPluginAsync } from "fastify";

export const dlqRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/dlq/messages?status=pending&limit=50
  app.get("/messages", {
    schema: {
      description: "List failed messages from the dead-letter queue.",
      tags: ["DLQ"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const query = request.query as { status?: string; limit?: string };
    const status = query.status ?? "pending";
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);

    const validStatuses = ["pending", "exhausted", "resolved"];
    if (!validStatuses.includes(status)) {
      return reply.code(400).send({ error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`, statusCode: 400 });
    }

    const messages = await app.prisma.failedMessage.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return reply.code(200).send({ messages });
  });

  // GET /api/dlq/stats
  app.get("/stats", {
    schema: {
      description: "Get aggregate counts of failed messages by status.",
      tags: ["DLQ"],
    },
  }, async (_request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const [pending, exhausted, resolved] = await Promise.all([
      app.prisma.failedMessage.count({ where: { status: "pending" } }),
      app.prisma.failedMessage.count({ where: { status: "exhausted" } }),
      app.prisma.failedMessage.count({ where: { status: "resolved" } }),
    ]);

    return reply.code(200).send({
      stats: { pending, exhausted, resolved, total: pending + exhausted + resolved },
    });
  });

  // POST /api/dlq/messages/:id/resolve
  app.post("/messages/:id/resolve", {
    schema: {
      description: "Mark a failed message as resolved.",
      tags: ["DLQ"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { id } = request.params as { id: string };

    const existing = await app.prisma.failedMessage.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: "Failed message not found", statusCode: 404 });
    }

    if (existing.status === "resolved") {
      return reply.code(200).send({ message: existing });
    }

    const updated = await app.prisma.failedMessage.update({
      where: { id },
      data: { status: "resolved", resolvedAt: new Date() },
    });

    return reply.code(200).send({ message: updated });
  });
};
