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
import { z } from "zod";
import { AgentType as AgentTypeEnum } from "@switchboard/schemas";

// ── Input Validation Schemas ──

const CreateListingInput = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  type: AgentTypeEnum,
  taskCategories: z.array(z.string()),
  webhookUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

const DeployInput = z.object({
  inputConfig: z.record(z.unknown()).optional(),
  governanceSettings: z.record(z.unknown()).optional(),
  outputDestination: z.record(z.unknown()).optional(),
  connectionIds: z.array(z.string()).optional(),
});

const CreateTaskInput = z.object({
  deploymentId: z.string().min(1),
  listingId: z.string().min(1),
  category: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  acceptanceCriteria: z.string().optional(),
});

const SubmitTaskOutput = z.object({
  output: z.record(z.unknown()),
});

const ReviewTaskInput = z.object({
  result: z.enum(["approved", "rejected"]),
  reviewResult: z.string().optional(),
});

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
    // Strip sensitive fields from public listing responses
    const sanitized = listings.map(({ webhookSecret: _ws, vettingNotes: _vn, ...rest }) => rest);
    return reply.send({ listings: sanitized });
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

    // Strip sensitive fields from public listing response
    const { webhookSecret: _ws, vettingNotes: _vn, ...sanitized } = listing;
    return reply.send({ listing: sanitized });
  });

  app.post("/listings", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    // Fix 5: Require auth for listing creation
    if (!request.organizationIdFromAuth) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    // Fix 3: Input validation
    const parsed = CreateListingInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const store = new PrismaListingStore(app.prisma);
    const listing = await store.create(parsed.data);
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

    // Fix 3: Input validation
    const parsed = DeployInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const deployment = await store.create({
      organizationId: orgId,
      listingId: id,
      inputConfig: parsed.data.inputConfig,
      governanceSettings: parsed.data.governanceSettings,
      outputDestination: parsed.data.outputDestination,
      connectionIds: parsed.data.connectionIds,
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

    // Fix 1: Use organizationIdFromAuth instead of accepting from body
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    // Fix 3: Input validation
    const parsed = CreateTaskInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const store = new PrismaAgentTaskStore(app.prisma);
    const task = await store.create({
      ...parsed.data,
      organizationId: orgId,
    });
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

    const task = await store.findById(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    // Verify org ownership
    const orgId = request.organizationIdFromAuth;
    if (orgId && task.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const parsed = SubmitTaskOutput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const updated = await store.submitOutput(id, parsed.data.output);
    return reply.send({ task: updated });
  });

  app.post("/tasks/:id/review", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const taskStore = new PrismaAgentTaskStore(app.prisma);
    const trustStore = new PrismaTrustScoreStore(app.prisma);
    const engine = new TrustScoreEngine(trustStore);

    const { id } = request.params as { id: string };

    // Fix 3: Input validation
    const parsed = ReviewTaskInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const reviewedBy = request.principalIdFromAuth ?? "unknown";

    const task = await taskStore.findById(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    // Verify org ownership
    const orgId = request.organizationIdFromAuth;
    if (orgId && task.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const updated = await taskStore.review(
      id,
      parsed.data.result,
      reviewedBy,
      parsed.data.reviewResult,
    );

    // Fix 4: Wrap trust score update in try/catch
    try {
      if (parsed.data.result === "approved") {
        await engine.recordApproval(task.listingId, task.category);
      } else {
        await engine.recordRejection(task.listingId, task.category);
      }
    } catch (error) {
      request.log.warn({ err: error }, "Failed to update trust score");
      // Task review succeeded, continue despite trust score failure
    }

    return reply.send({ task: updated });
  });
};
