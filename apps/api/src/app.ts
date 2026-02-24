import Fastify from "fastify";
import type { FastifyError } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { actionsRoutes } from "./routes/actions.js";
import { executeRoutes } from "./routes/execute.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { policiesRoutes } from "./routes/policies.js";
import { auditRoutes } from "./routes/audit.js";
import { identityRoutes } from "./routes/identity.js";
import { simulateRoutes } from "./routes/simulate.js";
import { healthRoutes } from "./routes/health.js";
import { interpretersRoutes } from "./routes/interpreters.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { authMiddleware } from "./middleware/auth.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  DEFAULT_REDACTION_CONFIG,
  GuardedCartridge,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  ExecutionService,
} from "@switchboard/core";
import type { StorageContext, LedgerStorage, PolicyCache } from "@switchboard/core";
import { AdsSpendCartridge, DEFAULT_ADS_POLICIES, PostMutationVerifier } from "@switchboard/ads-spend";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { createExecutionQueue, createExecutionWorker } from "./queue/index.js";
import { startApprovalExpiryJob } from "./jobs/approval-expiry.js";
import { startChainVerificationJob } from "./jobs/chain-verification.js";

declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
  }
  interface FastifyRequest {
    /** Set by auth when API_KEY_METADATA maps this key to an org. */
    organizationIdFromAuth?: string;
    /** Set by auth when API_KEY_METADATA maps this key to a runtime. */
    runtimeIdFromAuth?: string;
    /** Set by auth when API_KEY_METADATA maps this key to a principal. */
    principalIdFromAuth?: string;
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: true,
  });

  // CORS — restrict origins in production, allow all in development
  const allowedOrigins = process.env["CORS_ORIGIN"];
  await app.register(cors, {
    origin: allowedOrigins ? allowedOrigins.split(",") : true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: parseInt(process.env["RATE_LIMIT_MAX"] ?? "100", 10),
    timeWindow: parseInt(process.env["RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
  });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Switchboard API",
        description: "AI agent guardrail and approval orchestration API",
        version: "0.1.0",
      },
      tags: [
        { name: "Actions", description: "Propose, execute, undo, and batch actions" },
        { name: "Execute", description: "Single endpoint: propose + conditional execute (EXECUTED | PENDING_APPROVAL | DENIED)" },
        { name: "Approvals", description: "Respond to approval requests and list pending approvals" },
        { name: "Simulate", description: "Dry-run action evaluation without side effects" },
        { name: "Policies", description: "CRUD operations for guardrail policies" },
        { name: "Identity", description: "Manage identity specs and role overlays" },
        { name: "Audit", description: "Query audit ledger and verify chain integrity" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "API key passed as Bearer token. Set API_KEYS env var to enable.",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  // Global error handler — consistent error format, no stack leaks in production
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;

    if (statusCode >= 500) {
      app.log.error(error);
    }

    return reply.code(statusCode).send({
      error: message,
      statusCode,
    });
  });

  // Create storage and orchestrator — with degraded mode fallback
  let storage: StorageContext;
  let ledgerStorage: LedgerStorage;
  let degraded = false;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      const prisma = getDb();
      await prisma.$queryRaw`SELECT 1`; // verify connectivity
      storage = createPrismaStorage(prisma);
      ledgerStorage = new PrismaLedgerStorage(prisma);
    } catch (err) {
      app.log.error({ err }, "DATABASE_URL set but DB unreachable — falling back to in-memory (DEGRADED)");
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
      degraded = true;
    }
  } else {
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
  }

  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();
  const guardrailStateStore = createGuardrailStateStore();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // Register ads-spend cartridge
  const adsCartridge = new AdsSpendCartridge();
  const adsAccessToken = process.env["META_ADS_ACCESS_TOKEN"];
  const adsAccountId = process.env["META_ADS_ACCOUNT_ID"];
  if (process.env.NODE_ENV === "production" && (!adsAccessToken || !adsAccountId)) {
    throw new Error(
      "META_ADS_ACCESS_TOKEN and META_ADS_ACCOUNT_ID are required in production. " +
      "Set these environment variables or set NODE_ENV to something other than 'production'.",
    );
  }
  await adsCartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {
      accessToken: adsAccessToken ?? "mock-token-dev-only",
      adAccountId: adsAccountId ?? "act_mock_dev_only",
    },
  });
  const verifier = new PostMutationVerifier(() => adsCartridge.getProvider());
  storage.cartridges.register("ads-spend", new GuardedCartridge(adsCartridge, [verifier]));

  // Seed default data
  await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

  // Queue-based execution when Redis is available
  const redisUrl = process.env["REDIS_URL"];
  let onEnqueue: ((envelopeId: string) => Promise<void>) | undefined;
  const executionMode = redisUrl ? "queue" as const : "inline" as const;

  if (redisUrl) {
    const connection = { url: redisUrl };
    const queue = createExecutionQueue(connection);
    onEnqueue = async (envelopeId: string) => {
      await queue.add(`execute:${envelopeId}`, {
        envelopeId,
        enqueuedAt: new Date().toISOString(),
      });
    };
  }

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    executionMode,
    onEnqueue,
  });

  // Start worker in-process when queue mode is active
  if (redisUrl) {
    const worker = createExecutionWorker({
      connection: { url: redisUrl },
      orchestrator,
      storage,
    });
    app.addHook("onClose", async () => {
      await worker.close();
    });
  }

  // Start approval expiry background job
  const stopExpiryJob = startApprovalExpiryJob({ storage, ledger });
  app.addHook("onClose", async () => {
    stopExpiryJob();
  });

  // Start daily audit chain verification job
  const stopChainVerify = startChainVerificationJob({ ledger });
  app.addHook("onClose", async () => {
    stopChainVerify();
  });

  // Decorate Fastify with shared instances
  const executionService = new ExecutionService(orchestrator, storage);
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("executionService", executionService);

  // Register middleware
  await app.register(authMiddleware);
  await app.register(idempotencyMiddleware);

  // Health check
  app.get("/health", async () => ({
    status: degraded ? "degraded" : "ok",
    degraded,
    timestamp: new Date().toISOString(),
  }));

  // Register routes
  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(executeRoutes, { prefix: "/api" });
  await app.register(approvalsRoutes, { prefix: "/api/approvals" });
  await app.register(policiesRoutes, { prefix: "/api/policies" });
  await app.register(auditRoutes, { prefix: "/api/audit" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(simulateRoutes, { prefix: "/api/simulate" });
  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(interpretersRoutes, { prefix: "/api/interpreters" });

  return app;
}
