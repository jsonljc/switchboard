/* eslint-disable max-lines */
// ---------------------------------------------------------------------------
// Marketplace routes — agent listings, deployments, tasks, and trust scores
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import {
  PrismaListingStore,
  PrismaDeploymentStore,
  PrismaAgentTaskStore,
  PrismaTrustScoreStore,
  PrismaDeploymentConnectionStore,
  PrismaExecutionTraceStore,
  encryptCredentials,
  decryptCredentials,
} from "@switchboard/db";
import { randomBytes, createHash } from "node:crypto";
import { TrustScoreEngine, computeTrustProgression } from "@switchboard/core";
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
  persona: z
    .object({
      businessName: z.string().min(1),
      businessType: z.string().min(1),
      productService: z.string().min(1),
      valueProposition: z.string().min(1),
      tone: z.string().min(1),
      qualificationCriteria: z.record(z.unknown()).default({}),
      disqualificationCriteria: z.record(z.unknown()).default({}),
      escalationRules: z.record(z.unknown()).default({}),
      bookingLink: z.string().nullable().default(null),
      customInstructions: z.string().nullable().default(null),
    })
    .optional(),
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

const TelegramConnectInput = z.object({
  botToken: z.string().min(1),
  webhookBaseUrl: z.string().url(),
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

  app.get("/listings/:id/trust/progression", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const taskStore = new PrismaAgentTaskStore(app.prisma);

    const tasks = await taskStore.listByOrg(orgId, {
      listingId: id,
      limit: 500,
    });

    const outcomes = tasks
      .filter(
        (
          t,
        ): t is typeof t & {
          status: "approved" | "rejected";
          completedAt: NonNullable<typeof t.completedAt>;
        } => (t.status === "approved" || t.status === "rejected") && t.completedAt !== null,
      )
      .sort(
        (a, b) =>
          new Date(a.completedAt as string | Date).getTime() -
          new Date(b.completedAt as string | Date).getTime(),
      )
      .map((t) => ({
        status: t.status,
        completedAt:
          typeof t.completedAt === "string" ? t.completedAt : new Date(t.completedAt).toISOString(),
      }));

    const progression = computeTrustProgression(outcomes);
    return reply.send({ listingId: id, progression });
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
      inputConfig: {
        ...parsed.data.inputConfig,
        ...(parsed.data.persona ? { persona: parsed.data.persona } : {}),
      },
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

  app.patch<{
    Params: { id: string };
    Body: { inputConfig?: Record<string, unknown> };
  }>("/deployments/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
    }

    const { id } = request.params;
    const store = new PrismaDeploymentStore(app.prisma);
    const existing = await store.findById(id);

    if (!existing) {
      return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
    }
    if (existing.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const { inputConfig } = request.body ?? {};
    if (!inputConfig || typeof inputConfig !== "object") {
      return reply.code(400).send({ error: "inputConfig is required", statusCode: 400 });
    }

    const updated = await store.update(id, { inputConfig });
    return reply.send({ deployment: updated });
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

    const { status, deploymentId } = request.query as Record<string, string | undefined>;
    const filters = {
      status: status as AgentTaskStatus | undefined,
      deploymentId,
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

  // ── Deployment Connections ──

  app.post("/deployments/:id/connections/widget", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { id } = request.params as { id: string };
    const deploymentStore = new PrismaDeploymentStore(app.prisma);
    const deployment = await deploymentStore.findById(id);

    if (!deployment) {
      return reply.code(404).send({ error: "Deployment not found" });
    }
    if (deployment.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
    const existing = await connectionStore.listByDeployment(id);
    const activeWidget = existing.find((c) => c.type === "web_widget" && c.status === "active");

    if (activeWidget) {
      return reply.code(409).send({ error: "Active web_widget connection already exists" });
    }

    const token = "sw_" + randomBytes(15).toString("base64url").slice(0, 20);
    const encrypted = encryptCredentials({ token });
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const connection = await connectionStore.create({
      deploymentId: id,
      type: "web_widget",
      credentials: encrypted,
      metadata: {},
      tokenHash,
    });

    return reply.code(201).send({
      connection: { id: connection.id, type: "web_widget", token },
    });
  });

  app.post("/deployments/:id/connections/telegram", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { id } = request.params as { id: string };
    const deploymentStore = new PrismaDeploymentStore(app.prisma);
    const deployment = await deploymentStore.findById(id);

    if (!deployment) {
      return reply.code(404).send({ error: "Deployment not found" });
    }
    if (deployment.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const parsed = TelegramConnectInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const { botToken, webhookBaseUrl } = parsed.data;

    // Validate bot token with Telegram API
    let botUsername: string;
    try {
      const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const getMeData = (await getMeRes.json()) as {
        ok: boolean;
        result?: { username: string };
      };
      if (!getMeData.ok || !getMeData.result?.username) {
        return reply.code(400).send({ error: "Invalid Telegram bot token" });
      }
      botUsername = getMeData.result.username;
    } catch {
      return reply.code(502).send({ error: "Failed to validate bot token with Telegram" });
    }

    const webhookSecret = randomBytes(32).toString("hex");
    const encrypted = encryptCredentials({ botToken, webhookSecret });

    const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
    const connection = await connectionStore.create({
      deploymentId: id,
      type: "telegram",
      credentials: encrypted,
      metadata: { botUsername },
    });

    const webhookPath = `/webhook/managed/${connection.id}`;

    // Register webhook with Telegram
    try {
      const setWebhookRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${webhookBaseUrl}${webhookPath}`,
          secret_token: webhookSecret,
        }),
      });
      const setWebhookData = (await setWebhookRes.json()) as { ok: boolean };
      if (!setWebhookData.ok) {
        await connectionStore.delete(connection.id);
        return reply.code(502).send({ error: "Failed to register Telegram webhook" });
      }
    } catch {
      await connectionStore.delete(connection.id);
      return reply.code(502).send({ error: "Failed to register Telegram webhook" });
    }

    return reply.code(201).send({
      connection: { id: connection.id, type: "telegram", botUsername },
      webhookPath,
    });
  });

  app.get("/deployments/:id/connections", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { id } = request.params as { id: string };
    const deploymentStore = new PrismaDeploymentStore(app.prisma);
    const deployment = await deploymentStore.findById(id);

    if (!deployment) {
      return reply.code(404).send({ error: "Deployment not found" });
    }
    if (deployment.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
    const allConnections = await connectionStore.listByDeployment(id);

    const connections = allConnections.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      metadata: c.metadata,
    }));

    return reply.send({ connections });
  });

  app.delete("/deployments/:id/connections/:connectionId", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const { id, connectionId } = request.params as { id: string; connectionId: string };
    const deploymentStore = new PrismaDeploymentStore(app.prisma);
    const deployment = await deploymentStore.findById(id);

    if (!deployment) {
      return reply.code(404).send({ error: "Deployment not found" });
    }
    if (deployment.organizationId !== orgId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
    const connections = await connectionStore.listByDeployment(id);
    const connection = connections.find((c) => c.id === connectionId);

    if (!connection) {
      return reply.code(404).send({ error: "Connection not found" });
    }

    // For Telegram connections, clean up the webhook
    if (connection.type === "telegram") {
      try {
        const creds = decryptCredentials(connection.credentials) as {
          botToken?: string;
        };
        if (creds.botToken) {
          await fetch(`https://api.telegram.org/bot${creds.botToken}/deleteWebhook`);
        }
      } catch (error) {
        request.log.warn({ err: error }, "Failed to delete Telegram webhook during disconnect");
      }
    }

    await connectionStore.updateStatus(connectionId, "revoked");
    return reply.send({ ok: true });
  });

  // ── Execution Traces ──

  app.get<{
    Params: { deploymentId: string };
    Querystring: { limit?: string; cursor?: string };
  }>("/deployments/:deploymentId/traces", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { deploymentId } = request.params;
    const limit = Math.min(Number(request.query.limit) || 20, 100);
    const cursor = request.query.cursor;

    const traceStore = new PrismaExecutionTraceStore(app.prisma);
    const result = await traceStore.listByDeployment(orgId, deploymentId, { limit, cursor });

    return reply.send(result);
  });

  app.get<{
    Params: { traceId: string };
  }>("/traces/:traceId", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { traceId } = request.params;

    const traceStore = new PrismaExecutionTraceStore(app.prisma);
    const trace = await traceStore.findById(orgId, traceId);

    if (!trace) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    return reply.send({ trace });
  });
};
