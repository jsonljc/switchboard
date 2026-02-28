import Fastify from "fastify";
import type { FastifyError } from "fastify";
import helmet from "@fastify/helmet";
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
  setMetrics,
} from "@switchboard/core";
import type { StorageContext, LedgerStorage, PolicyCache } from "@switchboard/core";
import { bootstrapAdsSpendCartridge, DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";
import { bootstrapQuantTradingCartridge, DEFAULT_TRADING_POLICIES } from "@switchboard/quant-trading";
import { bootstrapPaymentsCartridge, DEFAULT_PAYMENTS_POLICIES } from "@switchboard/payments";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { createExecutionQueue, createExecutionWorker } from "./queue/index.js";
import { startApprovalExpiryJob } from "./jobs/approval-expiry.js";
import { startChainVerificationJob } from "./jobs/chain-verification.js";
import { createPromMetrics, metricsRoute } from "./metrics.js";
import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
    redis: Redis | null;
    executionQueue: Queue | null;
    executionWorker: Worker | null;
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
    bodyLimit: 1_048_576, // 1 MB explicit body size limit
  });

  // Security headers via Helmet (CSP disabled — API-only server, no HTML)
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS — restrict origins in production, allow all in development
  const allowedOrigins = process.env["CORS_ORIGIN"];
  if (process.env.NODE_ENV === "production" && !allowedOrigins) {
    throw new Error("CORS_ORIGIN must be set in production (e.g. 'https://app.example.com')");
  }
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

  // Only expose Swagger UI outside production (or when explicitly enabled)
  if (process.env.NODE_ENV !== "production" || process.env["ENABLE_SWAGGER"] === "true") {
    await app.register(swaggerUi, {
      routePrefix: "/docs",
    });
  }

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

  // Wire Prometheus metrics before orchestrator creation
  setMetrics(createPromMetrics());

  // Create storage and orchestrator — with degraded mode fallback
  let storage: StorageContext;
  let ledgerStorage: LedgerStorage;
  let prisma: { $queryRaw: (query: TemplateStringsArray) => Promise<unknown>; $disconnect: () => Promise<void> } | null = null;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      prisma = getDb();
      await prisma.$queryRaw`SELECT 1`; // verify connectivity
      storage = createPrismaStorage(prisma as Parameters<typeof createPrismaStorage>[0]);
      ledgerStorage = new PrismaLedgerStorage(prisma as ConstructorParameters<typeof PrismaLedgerStorage>[0]);
    } catch (err) {
      app.log.error({ err }, "DATABASE_URL set but DB unreachable — falling back to in-memory (DEGRADED)");
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
      prisma = null;
    }
  } else {
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
  }

  const ledger = new AuditLedger(ledgerStorage, DEFAULT_REDACTION_CONFIG);
  const guardrailState = createGuardrailState();

  // Shared Redis connection when REDIS_URL is available — created early so
  // guardrail state store can reuse it instead of opening its own connection.
  const redisUrl = process.env["REDIS_URL"];
  let redis: Redis | null = null;

  if (redisUrl) {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(redisUrl);
  }

  const guardrailStateStore = createGuardrailStateStore(redis ?? undefined);
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // Register ads-spend cartridge
  const adsAccessToken = process.env["META_ADS_ACCESS_TOKEN"];
  const adsAccountId = process.env["META_ADS_ACCOUNT_ID"];
  const { cartridge: adsCartridge, interceptors } = await bootstrapAdsSpendCartridge({
    accessToken: adsAccessToken ?? "mock-token-dev-only",
    adAccountId: adsAccountId ?? "act_mock_dev_only",
    requireCredentials: process.env.NODE_ENV === "production",
  });
  storage.cartridges.register("ads-spend", new GuardedCartridge(adsCartridge, interceptors));
  await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

  // Register quant-trading cartridge
  const { cartridge: tradingCartridge } = await bootstrapQuantTradingCartridge();
  storage.cartridges.register("quant-trading", new GuardedCartridge(tradingCartridge));
  await seedDefaultStorage(storage, DEFAULT_TRADING_POLICIES);

  // Register payments cartridge
  const { cartridge: paymentsCartridge } = await bootstrapPaymentsCartridge({
    secretKey: process.env["STRIPE_SECRET_KEY"] ?? "mock-key-dev-only",
    requireCredentials: process.env.NODE_ENV === "production",
  });
  storage.cartridges.register("payments", new GuardedCartridge(paymentsCartridge));
  await seedDefaultStorage(storage, DEFAULT_PAYMENTS_POLICIES);

  let queue: Queue | null = null;
  let worker: Worker | null = null;
  let onEnqueue: ((envelopeId: string) => Promise<void>) | undefined;
  const executionMode = redisUrl ? "queue" as const : "inline" as const;

  if (redisUrl) {
    const connection = { url: redisUrl };
    queue = createExecutionQueue(connection);
    onEnqueue = async (envelopeId: string) => {
      await queue!.add(`execute:${envelopeId}`, {
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
    worker = createExecutionWorker({
      connection: { url: redisUrl },
      orchestrator,
      storage,
      logger: app.log,
    });
  }

  // Start approval expiry background job
  const stopExpiryJob = startApprovalExpiryJob({ storage, ledger, logger: app.log });

  // Start daily audit chain verification job
  const stopChainVerify = startChainVerificationJob({ ledger, logger: app.log });

  // Decorate Fastify with shared instances
  const executionService = new ExecutionService(orchestrator, storage);
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("executionService", executionService);
  app.decorate("redis", redis);
  app.decorate("executionQueue", queue);
  app.decorate("executionWorker", worker);

  // Resource cleanup on close — order: worker → queue → Redis → Prisma
  app.addHook("onClose", async () => {
    stopExpiryJob();
    stopChainVerify();

    if (worker) {
      await worker.close();
    }
    if (queue) {
      await queue.close();
    }
    if (redis) {
      await redis.quit();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // Register middleware (idempotency picks up shared redis via app.redis)
  await app.register(authMiddleware);
  await app.register(idempotencyMiddleware);

  // Live health check — pings configured backends
  app.get("/health", async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    const timeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
      ]);

    // DB check
    if (prisma) {
      try {
        await timeout(prisma.$queryRaw`SELECT 1`, 3000);
        checks["database"] = "ok";
      } catch {
        checks["database"] = "unreachable";
        healthy = false;
      }
    }

    // Redis check
    if (redis) {
      try {
        await timeout(redis.ping(), 3000);
        checks["redis"] = "ok";
      } catch {
        checks["redis"] = "unreachable";
        healthy = false;
      }
    }

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // Prometheus metrics endpoint (excluded from auth like /health)
  app.get("/metrics", metricsRoute);

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
