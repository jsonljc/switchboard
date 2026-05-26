// @route-class: control-plane
// ---------------------------------------------------------------------------
// Deployment Memory routes — owner corrections & learned memory management
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaDeploymentMemoryStore, PrismaOwnerMemoryStore } from "@switchboard/db";
import { z } from "zod";
import { assertOrgAccess } from "../utils/org-access.js";

const CorrectMemoryInput = z.object({
  content: z.string().min(1),
  category: z.string().min(1),
});

export const deploymentMemoryRoutes: FastifyPluginAsync = async (app) => {
  // Tenant-isolation guard (A1). Every route in this plugin is scoped to a path
  // :orgId and passes it straight to the store. Without this guard a principal
  // authenticated for org A could read or mutate org B's learned memory and
  // FAQ-draft knowledge chunks just by changing the path orgId. Reject any
  // request whose authenticated org does not match the path orgId BEFORE the
  // handler (and therefore the data layer) runs. Mirrors the per-handler
  // assertOrgAccess discipline in organizations.ts / governance.ts, hoisted to
  // a plugin hook so no endpoint can be added without the check.
  app.addHook("preHandler", async (request, reply) => {
    const { orgId } = request.params as { orgId?: string };
    if (!assertOrgAccess(request, orgId, reply)) return reply;
  });

  // List all learned memories for a deployment
  app.get<{
    Params: { orgId: string; deploymentId: string };
  }>("/:orgId/deployments/:deploymentId/memory", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
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
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { orgId, deploymentId } = request.params;
    const parsed = CorrectMemoryInput.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input", details: parsed.error.issues, statusCode: 400 });
    }
    const body = parsed.data;
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
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const store = new PrismaDeploymentMemoryStore(app.prisma);
    const { orgId, deploymentId, memoryId } = request.params;
    // Verify ownership — only delete entries belonging to this org+deployment
    const entries = await store.listByDeployment(orgId, deploymentId);
    const entry = entries.find((e) => e.id === memoryId);
    if (!entry) {
      return reply.code(404).send({ error: "Memory entry not found", statusCode: 404 });
    }
    await store.delete(orgId, memoryId);
    return reply.status(204).send();
  });

  // List pending FAQ drafts for a deployment
  app.get<{
    Params: { orgId: string; deploymentId: string };
  }>("/:orgId/deployments/:deploymentId/faq-drafts", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const ownerStore = new PrismaOwnerMemoryStore(app.prisma);
    const { orgId, deploymentId } = request.params;
    const drafts = await ownerStore.listDraftFAQs(orgId, deploymentId);
    return { data: drafts };
  });

  // Approve a FAQ draft (with ownership verification)
  app.post<{
    Params: { orgId: string; deploymentId: string; faqId: string };
  }>("/:orgId/deployments/:deploymentId/faq-drafts/:faqId/approve", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const ownerStore = new PrismaOwnerMemoryStore(app.prisma);
    const { orgId, deploymentId, faqId } = request.params;
    // Verify the FAQ belongs to this org+deployment
    const drafts = await ownerStore.listDraftFAQs(orgId, deploymentId);
    if (!drafts.some((d) => d.id === faqId)) {
      return reply.code(404).send({ error: "FAQ draft not found", statusCode: 404 });
    }
    await ownerStore.approveDraftFAQ(orgId, faqId);
    return { success: true };
  });

  // Reject (delete) a FAQ draft (with ownership verification)
  app.post<{
    Params: { orgId: string; deploymentId: string; faqId: string };
  }>("/:orgId/deployments/:deploymentId/faq-drafts/:faqId/reject", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const ownerStore = new PrismaOwnerMemoryStore(app.prisma);
    const { orgId, deploymentId, faqId } = request.params;
    // Verify the FAQ belongs to this org+deployment
    const drafts = await ownerStore.listDraftFAQs(orgId, deploymentId);
    if (!drafts.some((d) => d.id === faqId)) {
      return reply.code(404).send({ error: "FAQ draft not found", statusCode: 404 });
    }
    await ownerStore.rejectDraftFAQ(orgId, faqId);
    return reply.status(204).send();
  });
};
