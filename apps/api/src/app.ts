import Fastify from "fastify";
import crypto from "node:crypto";
import type { FastifyError } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { setMetrics, ExecutionService, LifecycleOrchestrator } from "@switchboard/core";
import type {
  StorageContext,
  PolicyCache,
  TierStore,
  ResolvedSkin,
  ResolvedProfile,
  AgentNotifier,
} from "@switchboard/core";
import { SmbActivityLog, AuditLedger } from "@switchboard/core";
import { initTelemetry } from "./telemetry/otel-init.js";
import { createPromMetrics, metricsRoute } from "./metrics.js";
import { authMiddleware } from "./middleware/auth.js";
import apiVersionPlugin from "./versioning.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { bootstrapStorage } from "./bootstrap/storage.js";
import { ensureSystemIdentity } from "./bootstrap/system-identity.js";
import {
  resolveCartridgeCredentials,
  registerCartridges,
  wireEscalationNotifier,
} from "./bootstrap/cartridges.js";
import { startBackgroundJobs } from "./bootstrap/jobs.js";
import { registerRoutes } from "./bootstrap/routes.js";
import { registerSwagger } from "./bootstrap/swagger.js";
import { loadAndApplySkin, resolveBusinessProfile } from "./bootstrap/skin.js";
import { bootstrapServices } from "./bootstrap/services.js";
import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
    tierStore: TierStore;
    smbActivityLog: SmbActivityLog;
    redis: Redis | null;
    executionQueue: Queue | null;
    executionWorker: Worker | null;
    prisma: import("@switchboard/db").PrismaClient | null;
    governanceProfileStore: import("@switchboard/core").GovernanceProfileStore;
    resolvedSkin: ResolvedSkin | null;
    resolvedProfile: ResolvedProfile | null;
    agentNotifier: AgentNotifier | null;
    conversionBus: import("@switchboard/core").ConversionBus | null;
    agentSystem: import("./agent-bootstrap.js").AgentSystem;
    ingestionPipeline: import("@switchboard/agents").IngestionPipeline | null;
    sessionManager: import("@switchboard/core/sessions").SessionManager | null;
    workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null;
    schedulerService: import("@switchboard/core").SchedulerService | null;
    operatorDeps: import("./bootstrap/operator-deps.js").OperatorDeps | null;
    lifecycleDeps: import("./bootstrap/lifecycle-deps.js").LifecycleDeps | null;
  }
  interface FastifyRequest {
    /** Set by auth when API_KEY_METADATA maps this key to an org. */
    organizationIdFromAuth?: string;
    /** Set by auth when API_KEY_METADATA maps this key to a runtime. */
    runtimeIdFromAuth?: string;
    /** Set by auth when API_KEY_METADATA maps this key to a principal. */
    principalIdFromAuth?: string;
    /** Request-level trace ID for correlation (from X-Request-Id header or auto-generated). */
    traceId?: string;
  }
}

export async function buildServer() {
  // Initialize OpenTelemetry before Fastify starts (must be first)
  await initTelemetry();

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
    app.log.warn(
      "CORS_ORIGIN is not set in production. Cross-origin requests will be rejected. " +
        "Set CORS_ORIGIN to a comma-separated list of allowed origins (e.g. 'https://app.example.com').",
    );
  }
  await app.register(cors, {
    origin: allowedOrigins
      ? allowedOrigins.split(",")
      : process.env.NODE_ENV === "production"
        ? false
        : true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: parseInt(process.env["RATE_LIMIT_MAX"] ?? "100", 10),
    timeWindow: parseInt(process.env["RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
  });

  // OpenAPI documentation + optional Swagger UI
  await registerSwagger(app);

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

  // Credential encryption key check — hard-fail in production, warn otherwise
  if (process.env["DATABASE_URL"] && !process.env["CREDENTIALS_ENCRYPTION_KEY"]) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CREDENTIALS_ENCRYPTION_KEY is required in production when DATABASE_URL is set. " +
          "Set it to a strong random secret (min 32 chars).",
      );
    }
    app.log.warn(
      "CREDENTIALS_ENCRYPTION_KEY is not set but DATABASE_URL is configured. " +
        "Connection credential storage/retrieval will fail. " +
        "Set CREDENTIALS_ENCRYPTION_KEY to a strong random secret (min 32 chars).",
    );
  }

  // --- Bootstrap storage layer ---
  const {
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    tierStore,
    smbActivityLog,
    prismaClient,
    redis,
  } = await bootstrapStorage(app.log);

  if (prismaClient) {
    await ensureSystemIdentity(prismaClient);
  }

  // --- Resolve credentials and register cartridges ---
  const credentials = await resolveCartridgeCredentials(prismaClient, app.log);
  const { adsWriteProvider, businessProfile } = await registerCartridges(
    storage,
    credentials,
    redis,
    app.log,
  );
  await wireEscalationNotifier();

  // --- Resolve business profile (optional, loaded from PROFILE_ID in cartridge bootstrap) ---
  const resolvedProfile: ResolvedProfile | null = businessProfile
    ? resolveBusinessProfile(businessProfile, app.log)
    : null;

  // --- Skin loading (optional, controlled by SKIN_ID env var) ---
  const skinId = process.env["SKIN_ID"];
  const resolvedSkin: ResolvedSkin | null = skinId
    ? await loadAndApplySkin(skinId, storage, governanceProfileStore, app.log)
    : null;

  // --- Bootstrap all services (agents, orchestrator, queues, etc.) ---
  const {
    orchestrator,
    executionService,
    agentSystem,
    conversionBus,
    sessionManager,
    workflowDeps,
    schedulerDeps,
    operatorDeps,
    lifecycleDeps,
    ingestionPipeline,
    queue,
    worker,
  } = await bootstrapServices({
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    tierStore,
    smbActivityLog,
    prismaClient,
    logger: app.log,
    adsWriteProvider,
  });

  // --- Start background jobs ---
  const { stop: stopAllJobs, agentNotifier } = await startBackgroundJobs({
    storage,
    ledger,
    orchestrator,
    prismaClient,
    redis,
    resolvedSkin,
    resolvedProfile,
    logger: app.log,
  });

  // --- Decorate Fastify with shared instances ---
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("executionService", executionService);
  app.decorate("tierStore", tierStore);
  app.decorate("smbActivityLog", smbActivityLog);
  app.decorate("redis", redis);
  app.decorate("executionQueue", queue);
  app.decorate("executionWorker", worker);
  app.decorate("prisma", prismaClient);
  app.decorate("governanceProfileStore", governanceProfileStore);
  app.decorate("resolvedSkin", resolvedSkin);
  app.decorate("resolvedProfile", resolvedProfile);
  app.decorate("agentNotifier", agentNotifier);
  app.decorate("conversionBus", conversionBus);
  app.decorate("agentSystem", agentSystem);
  app.decorate("ingestionPipeline", ingestionPipeline);
  app.decorate("sessionManager", sessionManager);
  app.decorate("workflowDeps", workflowDeps);
  app.decorate("schedulerService", schedulerDeps?.service ?? null);
  app.decorate("operatorDeps", operatorDeps);
  app.decorate("lifecycleDeps", lifecycleDeps);

  // Resource cleanup on close — order: agents → jobs → worker → queue → Redis → Prisma
  app.addHook("onClose", async () => {
    agentSystem.scheduledRunner.stop();

    await stopAllJobs();

    if (schedulerDeps) {
      await schedulerDeps.cleanup();
    }

    if (worker) {
      await worker.close();
    }
    if (queue) {
      await queue.close();
    }
    if (redis) {
      await redis.quit();
    }
    if (prismaClient) {
      await prismaClient.$disconnect();
    }
  });

  // Register middleware (idempotency picks up shared redis via app.redis)
  await app.register(authMiddleware);
  await app.register(apiVersionPlugin);
  await app.register(idempotencyMiddleware);

  // Assign a traceId to every request (from X-Request-Id header or auto-generated)
  app.addHook("onRequest", async (request) => {
    const headerVal = request.headers["x-request-id"];
    request.traceId =
      typeof headerVal === "string" && headerVal.trim() ? headerVal.trim() : crypto.randomUUID();
  });

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
    if (prismaClient) {
      try {
        await timeout(prismaClient.$queryRaw`SELECT 1`, 3000);
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

  // --- Per-org LLM concurrency limiter ---
  const { OrgConcurrencyLimiter } = await import("./middleware/rate-limiter.js");
  const llmLimiter = new OrgConcurrencyLimiter({ maxConcurrent: 5, queueTimeoutMs: 30_000 });

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url;
    if (!path.startsWith("/api/test-chat") && !path.startsWith("/api/knowledge")) {
      return;
    }
    const orgId = request.organizationIdFromAuth ?? "default";
    try {
      const release = await llmLimiter.acquire(orgId);
      request.raw.on("close", release);
    } catch {
      return reply.code(503).send({
        error: "Too many concurrent requests. Please retry.",
        statusCode: 503,
        retryAfter: 5,
      });
    }
  });

  // --- Register all API routes ---
  await registerRoutes(app);

  return app;
}
