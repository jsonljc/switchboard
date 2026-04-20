import type { FastifyPluginAsync } from "fastify";
import { PrismaOwnerTaskStore } from "@switchboard/db";
import type { TaskStatus } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const ownerTaskRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:orgId/tasks", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaOwnerTaskStore(app.prisma);
    const tasks = await store.listOpen(orgId);
    return reply.send({ tasks, openCount: tasks.openCount, overdueCount: tasks.overdueCount });
  });

  app.patch("/:orgId/tasks/:taskId", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database not available" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { taskId } = request.params as { taskId: string };
    const { status } = request.body as { status: TaskStatus };

    const store = new PrismaOwnerTaskStore(app.prisma);
    const completedAt = status === "completed" ? new Date() : undefined;
    const task = await store.updateStatus(orgId, taskId, status, completedAt);
    return reply.send({ task });
  });
};
