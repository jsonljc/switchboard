// ---------------------------------------------------------------------------
// Deployment Memory routes — owner corrections & learned memory management
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaDeploymentMemoryStore } from "@switchboard/db";
import { z } from "zod";

const CorrectMemoryInput = z.object({
  content: z.string().min(1),
  category: z.string().min(1),
});

export const deploymentMemoryRoutes: FastifyPluginAsync = async (app) => {
  // List all learned memories for a deployment
  app.get<{
    Params: { orgId: string; deploymentId: string };
  }>("/:orgId/deployments/:deploymentId/memory", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { orgId, deploymentId } = request.params;
    const entries = await store.listByDeployment(orgId, deploymentId);
    return { data: entries };
  });

  // Add an owner correction (confidence = 1.0)
  app.post<{
    Params: { orgId: string; deploymentId: string };
    Body: z.infer<typeof CorrectMemoryInput>;
  }>("/:orgId/deployments/:deploymentId/memory", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { orgId, deploymentId } = request.params;
    const body = CorrectMemoryInput.parse(request.body);
    const entry = await store.create({
      organizationId: orgId,
      deploymentId,
      category: body.category,
      content: body.content,
      confidence: 1.0,
    });
    return reply.status(201).send({ data: entry });
  });

  // Delete a memory entry (owner override)
  app.delete<{
    Params: { orgId: string; deploymentId: string; memoryId: string };
  }>("/:orgId/deployments/:deploymentId/memory/:memoryId", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { memoryId } = request.params;
    await store.delete(memoryId);
    return reply.status(204).send();
  });
};
