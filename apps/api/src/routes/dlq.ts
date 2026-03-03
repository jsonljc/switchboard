import type { FastifyPluginAsync } from "fastify";
import { assertOrgAccess } from "../utils/org-access.js";

export const dlqRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/dlq/messages?status=pending&limit=50
  app.get(
    "/messages",
    {
      schema: {
        description: "List failed messages from the dead-letter queue.",
        tags: ["DLQ"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const query = request.query as { status?: string; limit?: string };
      const status = query.status ?? "pending";
      const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);

      const validStatuses = ["pending", "exhausted", "resolved"];
      if (!validStatuses.includes(status)) {
        return reply.code(400).send({
          error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`,
          statusCode: 400,
        });
      }

      const messages = await app.prisma.failedMessage.findMany({
        where: {
          status,
          ...(request.organizationIdFromAuth
            ? { organizationId: request.organizationIdFromAuth }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return reply.code(200).send({ messages });
    },
  );

  // GET /api/dlq/stats
  app.get(
    "/stats",
    {
      schema: {
        description: "Get aggregate counts of failed messages by status.",
        tags: ["DLQ"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgFilter = request.organizationIdFromAuth
        ? { organizationId: request.organizationIdFromAuth }
        : {};

      const [pending, exhausted, resolved] = await Promise.all([
        app.prisma.failedMessage.count({ where: { status: "pending", ...orgFilter } }),
        app.prisma.failedMessage.count({ where: { status: "exhausted", ...orgFilter } }),
        app.prisma.failedMessage.count({ where: { status: "resolved", ...orgFilter } }),
      ]);

      return reply.code(200).send({
        stats: { pending, exhausted, resolved, total: pending + exhausted + resolved },
      });
    },
  );

  // POST /api/dlq/messages/:id/resolve
  app.post(
    "/messages/:id/resolve",
    {
      schema: {
        description: "Mark a failed message as resolved.",
        tags: ["DLQ"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { id } = request.params as { id: string };

      const existing = await app.prisma.failedMessage.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: "Failed message not found", statusCode: 404 });
      }

      if (!assertOrgAccess(request, existing.organizationId, reply)) return;

      if (existing.status === "resolved") {
        return reply.code(200).send({ message: existing });
      }

      const updated = await app.prisma.failedMessage.update({
        where: { id },
        data: { status: "resolved", resolvedAt: new Date() },
      });

      return reply.code(200).send({ message: updated });
    },
  );

  // POST /api/dlq/messages/:id/retry — increment retry count; exhausts after maxRetries
  app.post(
    "/messages/:id/retry",
    {
      schema: {
        description:
          "Record a retry attempt on a failed message. Transitions to 'exhausted' when maxRetries is reached.",
        tags: ["DLQ"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { id } = request.params as { id: string };
      const body = request.body as { errorMessage?: string } | undefined;

      const existing = await app.prisma.failedMessage.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: "Failed message not found", statusCode: 404 });
      }

      if (!assertOrgAccess(request, existing.organizationId, reply)) return;

      if (existing.status !== "pending") {
        return reply.code(409).send({
          error: `Cannot retry message with status '${existing.status}'`,
          statusCode: 409,
        });
      }

      const nextCount = existing.retryCount + 1;
      const exhausted = nextCount >= existing.maxRetries;

      const updated = await app.prisma.failedMessage.update({
        where: { id },
        data: {
          retryCount: nextCount,
          errorMessage: body?.errorMessage ?? existing.errorMessage,
          status: exhausted ? "exhausted" : "pending",
        },
      });

      return reply.code(200).send({ message: updated, exhausted });
    },
  );

  // POST /api/dlq/sweep — transition all over-limit pending messages to exhausted
  app.post(
    "/sweep",
    {
      schema: {
        description:
          "Sweep pending messages that have exceeded maxRetries and mark them exhausted.",
        tags: ["DLQ"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgFilter = request.organizationIdFromAuth
        ? { organizationId: request.organizationIdFromAuth }
        : {};

      // Find pending messages where retryCount >= maxRetries
      const overdue = await app.prisma.failedMessage.findMany({
        where: { status: "pending", ...orgFilter },
        select: { id: true, retryCount: true, maxRetries: true },
      });

      const ids = overdue
        .filter((m: (typeof overdue)[number]) => m.retryCount >= m.maxRetries)
        .map((m: (typeof overdue)[number]) => m.id);

      if (ids.length === 0) {
        return reply.code(200).send({ swept: 0 });
      }

      const result = await app.prisma.failedMessage.updateMany({
        where: { id: { in: ids } },
        data: { status: "exhausted" },
      });

      return reply.code(200).send({ swept: result.count });
    },
  );
};
