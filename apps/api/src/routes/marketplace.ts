// ---------------------------------------------------------------------------
// Marketplace routes — agent listings, deployments, tasks, and trust scores
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import {
  PrismaListingStore,
  PrismaDeploymentStore,
  PrismaAgentTaskStore,
  PrismaTrustScoreStore,
} from "@switchboard/db";
import { TrustScoreEngine } from "@switchboard/core";
import type { AgentListingStatus, AgentType, AgentTaskStatus } from "@switchboard/schemas";

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  // ── Agent Listings ──

  app.get("/listings", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaListingStore(app.prisma);
    const { status, type, limit, offset } = request.query as Record<string, string | undefined>;

    const filters = {
      status: status as AgentListingStatus | undefined,
      type: type as AgentType | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };

    const listings = await store.list(filters);
    return reply.send({ listings });
  });

  app.get("/listings/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaListingStore(app.prisma);
    const { id } = request.params as { id: string };
    const listing = await store.findById(id);

    if (!listing) {
      return reply.code(404).send({ error: "Listing not found" });
    }

    return reply.send({ listing });
  });

  app.post("/listings", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaListingStore(app.prisma);
    const body = request.body as {
      name: string;
      slug: string;
      description: string;
      type: AgentType;
      taskCategories: string[];
      webhookUrl?: string | null;
      webhookSecret?: string | null;
      sourceUrl?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const listing = await store.create(body);
    return reply.code(201).send({ listing });
  });

  // ── Trust Scores ──

  app.get("/listings/:id/trust", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const trustStore = new PrismaTrustScoreStore(app.prisma);
    const engine = new TrustScoreEngine(trustStore);
    const { id } = request.params as { id: string };

    const breakdown = await engine.getScoreBreakdown(id);
    const priceTier = await engine.getPriceTier(id);

    return reply.send({ listingId: id, priceTier, breakdown });
  });

  // ── Deployments ──

  app.post("/listings/:id/deploy", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaDeploymentStore(app.prisma);
    const { id } = request.params as { id: string };
    const orgId = request.organizationIdFromAuth;

    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const body = request.body as {
      inputConfig?: Record<string, unknown>;
      governanceSettings?: Record<string, unknown>;
    };
    const deployment = await store.create({
      organizationId: orgId,
      listingId: id,
      inputConfig: body.inputConfig,
      governanceSettings: body.governanceSettings,
    });

    return reply.code(201).send({ deployment });
  });

  app.get("/deployments", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaDeploymentStore(app.prisma);
    const orgId = request.organizationIdFromAuth;

    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const deployments = await store.listByOrg(orgId);
    return reply.send({ deployments });
  });

  // ── Tasks ──

  app.post("/tasks", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaAgentTaskStore(app.prisma);
    const body = request.body as {
      deploymentId: string;
      organizationId: string;
      listingId: string;
      category: string;
      input: Record<string, unknown>;
      acceptanceCriteria?: string;
    };
    const task = await store.create(body);
    return reply.code(201).send({ task });
  });

  app.get("/tasks", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaAgentTaskStore(app.prisma);
    const orgId = request.organizationIdFromAuth;

    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { status } = request.query as Record<string, string | undefined>;
    const filters = {
      status: status as AgentTaskStatus | undefined,
    };

    const tasks = await store.listByOrg(orgId, filters);
    return reply.send({ tasks });
  });

  app.post("/tasks/:id/submit", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const store = new PrismaAgentTaskStore(app.prisma);
    const { id } = request.params as { id: string };
    const { output } = request.body as { output: Record<string, unknown> };

    const task = await store.submitOutput(id, output);
    return reply.send({ task });
  });

  app.post("/tasks/:id/review", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const taskStore = new PrismaAgentTaskStore(app.prisma);
    const trustStore = new PrismaTrustScoreStore(app.prisma);
    const engine = new TrustScoreEngine(trustStore);

    const { id } = request.params as { id: string };
    const { result, reviewResult } = request.body as {
      result: "approved" | "rejected";
      reviewResult?: string;
    };
    const reviewedBy = request.principalIdFromAuth ?? "unknown";

    const task = await taskStore.findById(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const updated = await taskStore.review(id, result, reviewedBy, reviewResult);

    // Update trust score based on review outcome
    if (result === "approved") {
      await engine.recordApproval(task.listingId, task.category);
    } else {
      await engine.recordRejection(task.listingId, task.category);
    }

    return reply.send({ task: updated });
  });
};
