import Fastify from "fastify";
import crypto from "node:crypto";
import type { FastifyError } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import {
  LifecycleOrchestrator,
  ExecutionService,
  CompositeNotifier,
  setMetrics,
} from "@switchboard/core";
import type {
  StorageContext,
  PolicyCache,
  ApprovalNotifier,
  TierStore,
  ResolvedSkin,
  ResolvedProfile,
  AgentNotifier,
} from "@switchboard/core";
import { SmbActivityLog, AuditLedger } from "@switchboard/core";
import { createExecutionQueue, createExecutionWorker } from "./queue/index.js";
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
    roleManifests: Map<string, import("./bootstrap/role-manifests.js").LoadedManifest>;
    workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null;
    schedulerService: import("@switchboard/core").SchedulerService | null;
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

  // --- ConversionBus wiring (CRM → ads feedback loop) ---
  const { InMemoryConversionBus } = await import("@switchboard/core");
  const conversionBus = new InMemoryConversionBus();

  if (adsWriteProvider && prismaClient) {
    const { CAPIDispatcher, OutcomeTracker, TikTokDispatcher, GoogleOfflineDispatcher } =
      await import("@switchboard/digital-ads");
    const { PrismaCrmProvider } = await import("@switchboard/db");

    const dispatcher = new CAPIDispatcher({
      adsProvider: adsWriteProvider,
      crmProvider: new PrismaCrmProvider(prismaClient),
      pixelId: process.env["META_PIXEL_ID"] ?? "",
    });
    dispatcher.register(conversionBus);

    const outcomeTracker = new OutcomeTracker();
    outcomeTracker.register(conversionBus);

    const registeredDispatchers = ["CAPIDispatcher", "OutcomeTracker"];

    // TikTok Events API dispatcher (gated by TIKTOK_PIXEL_ID)
    const tiktokPixelId = process.env["TIKTOK_PIXEL_ID"];
    if (tiktokPixelId) {
      const tiktokDispatcher = new TikTokDispatcher({
        sendEvent: async (_pixelId, _event) => ({ success: true }), // stub — real TikTok API client to come
        crmProvider: new PrismaCrmProvider(prismaClient),
        pixelId: tiktokPixelId,
      });
      tiktokDispatcher.register(conversionBus);
      registeredDispatchers.push("TikTokDispatcher");
    }

    // Google Offline Conversions dispatcher (gated by GOOGLE_CONVERSION_ACTION_ID)
    const googleConversionActionId = process.env["GOOGLE_CONVERSION_ACTION_ID"];
    if (googleConversionActionId) {
      const googleDispatcher = new GoogleOfflineDispatcher({
        uploadConversion: async (_conversion) => ({ success: true }), // stub — real Google Ads client to come
        crmProvider: new PrismaCrmProvider(prismaClient),
        conversionActionId: googleConversionActionId,
      });
      googleDispatcher.register(conversionBus);
      registeredDispatchers.push("GoogleOfflineDispatcher");
    }

    app.log.info(`ConversionBus wired: ${registeredDispatchers.join(" + ")} registered`);
  }

  // --- Agent orchestration system ---
  const { bootstrapAgentSystem } = await import("./agent-bootstrap.js");

  let deliveryStore: import("@switchboard/agents").DeliveryStore | undefined;
  if (prismaClient) {
    const { PrismaDeliveryStore } = await import("@switchboard/db");
    deliveryStore = new PrismaDeliveryStore(prismaClient);
  }

  // --- Thread store for per-contact derived state ---
  let threadStore: import("@switchboard/core").ConversationThreadStore | undefined;
  if (prismaClient) {
    const { PrismaConversationThreadStore } = await import("@switchboard/db");
    threadStore = new PrismaConversationThreadStore(prismaClient);
  }

  // --- Conversation deps (LLM + knowledge for agent handlers) ---
  let conversationDeps: import("./bootstrap/conversation-deps.js").ConversationDeps | null = null;
  let knowledgeStore: import("@switchboard/core").KnowledgeStore | null = null;
  if (prismaClient && process.env["ANTHROPIC_API_KEY"]) {
    const { buildConversationDeps } = await import("./bootstrap/conversation-deps.js");
    const { PrismaConversationStore, PrismaKnowledgeStore } = await import("@switchboard/db");
    knowledgeStore = new PrismaKnowledgeStore(prismaClient);
    conversationDeps = buildConversationDeps({
      anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
      voyageApiKey: process.env["VOYAGE_API_KEY"],
      conversationStore: new PrismaConversationStore(prismaClient, "default"),
      knowledgeStore,
    });
    if (conversationDeps) {
      app.log.info("Conversation deps wired (LLM + knowledge retriever)");
    }
  }

  // Build ingestion pipeline — reuses embedding adapter and knowledge store from conversation deps
  let ingestionPipeline: import("@switchboard/agents").IngestionPipeline | null = null;
  if (conversationDeps && knowledgeStore) {
    const { IngestionPipeline } = await import("@switchboard/agents");

    ingestionPipeline = new IngestionPipeline({
      store: knowledgeStore,
      embedding: conversationDeps.embeddingAdapter,
    });
  }

  const agentSystem = bootstrapAgentSystem({
    conversionBus,
    deliveryStore,
    leadResponderConversationDeps: conversationDeps ?? undefined,
    salesCloserConversationDeps: conversationDeps ?? undefined,
    conversationStore: conversationDeps?.conversationStore
      ? {
          getStage: conversationDeps.conversationStore.getStage.bind(
            conversationDeps.conversationStore,
          ),
        }
      : undefined,
    threadStore,
    logger: {
      warn: (msg: string) => app.log.warn(msg),
      error: (msg: string, err?: unknown) => app.log.error({ err }, msg),
      info: (msg: string) => app.log.info(msg),
    },
  });
  app.decorate("agentSystem", agentSystem);
  app.decorate("ingestionPipeline", ingestionPipeline);
  app.log.info(
    `Agent orchestration system bootstrapped (delivery store: ${deliveryStore ? "prisma" : "in-memory"})`,
  );

  // --- Session runtime bootstrap (optional — requires DATABASE_URL + SESSION_TOKEN_SECRET) ---
  let sessionManager: import("@switchboard/core/sessions").SessionManager | null = null;
  const roleManifests = new Map<string, import("./bootstrap/role-manifests.js").LoadedManifest>();
  const maxConcurrentSessionsEnv = parseInt(process.env["MAX_CONCURRENT_SESSIONS"] ?? "10", 10);

  if (prismaClient && process.env["SESSION_TOKEN_SECRET"]) {
    const { SessionManager } = await import("@switchboard/core/sessions");
    const {
      PrismaSessionStore,
      PrismaRunStore,
      PrismaPauseStore,
      PrismaToolEventStore,
      PrismaRoleOverrideStore,
    } = await import("@switchboard/db");
    const { loadRoleManifests } = await import("./bootstrap/role-manifests.js");

    const loadedManifests = await loadRoleManifests({ logger: app.log });
    for (const [id, loaded] of loadedManifests) {
      roleManifests.set(id, loaded);
    }

    const getRoleCheckpointValidator = (roleId: string) =>
      roleManifests.get(roleId)?.checkpointValidate;

    sessionManager = new SessionManager({
      sessions: new PrismaSessionStore(prismaClient),
      runs: new PrismaRunStore(prismaClient),
      pauses: new PrismaPauseStore(prismaClient),
      toolEvents: new PrismaToolEventStore(prismaClient),
      roleOverrides: new PrismaRoleOverrideStore(prismaClient),
      maxConcurrentSessions: maxConcurrentSessionsEnv,
      getRoleCheckpointValidator,
    });

    app.log.info(`Session runtime enabled with ${loadedManifests.size} role manifest(s)`);
  }

  app.decorate("sessionManager", sessionManager);
  app.decorate("roleManifests", roleManifests);

  // --- Workflow engine bootstrap (optional — requires DATABASE_URL) ---
  let workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null = null;
  if (prismaClient) {
    const { buildWorkflowDeps } = await import("./bootstrap/workflow-deps.js");
    const stepPolicyBridge: import("@switchboard/core").StepExecutorPolicyBridge = {
      evaluate: async (intent: {
        eventId: string;
        destinationType: string;
        destinationId: string;
        action: string;
        payload: unknown;
        criticality: string;
      }) => {
        // Cast to DeliveryIntent — StepExecutorPolicyBridge uses loose types for structural typing
        const deliveryIntent: import("@switchboard/agents").DeliveryIntent = {
          ...intent,
          destinationType: intent.destinationType as never,
          criticality: intent.criticality as never,
        };
        const result = await agentSystem.policyBridge.evaluate(deliveryIntent);
        return {
          approved: result.approved,
          requiresApproval: result.requiresApproval ?? false,
          reason: result.reason,
        };
      },
    };
    workflowDeps = buildWorkflowDeps(prismaClient, agentSystem.actionExecutor, stepPolicyBridge);
    if (workflowDeps) {
      app.log.info("Workflow engine bootstrapped");
    }
  }
  app.decorate("workflowDeps", workflowDeps);

  // --- Execution queue setup ---
  let queue: Queue | null = null;
  let worker: Worker | null = null;
  let onEnqueue: ((envelopeId: string) => Promise<void>) | undefined;
  const redisUrl = process.env["REDIS_URL"];
  const executionMode = redisUrl ? ("queue" as const) : ("inline" as const);

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

  // --- Scheduler service bootstrap (optional — requires DATABASE_URL + REDIS_URL + workflow engine) ---
  let schedulerDeps: import("./bootstrap/scheduler-deps.js").SchedulerDeps | null = null;
  if (prismaClient && redisUrl && workflowDeps) {
    const { buildSchedulerDeps } = await import("./bootstrap/scheduler-deps.js");
    schedulerDeps = buildSchedulerDeps(prismaClient, redisUrl, workflowDeps.workflowEngine);
    app.log.info("Scheduler service bootstrapped");
  }
  app.decorate("schedulerService", schedulerDeps?.service ?? null);

  // --- Approval notifier wiring ---
  const approvalNotifiers: ApprovalNotifier[] = [];
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    const { TelegramApprovalNotifier } = await import("./notifications/telegram-notifier.js");
    approvalNotifiers.push(new TelegramApprovalNotifier(process.env["TELEGRAM_BOT_TOKEN"]));
  }
  if (process.env["SLACK_BOT_TOKEN"]) {
    const { SlackApprovalNotifier } = await import("./notifications/slack-notifier.js");
    approvalNotifiers.push(new SlackApprovalNotifier(process.env["SLACK_BOT_TOKEN"]));
  }
  if (process.env["WHATSAPP_TOKEN"] && process.env["WHATSAPP_PHONE_NUMBER_ID"]) {
    const { WhatsAppApprovalNotifier } = await import("./notifications/whatsapp-notifier.js");
    approvalNotifiers.push(
      new WhatsAppApprovalNotifier({
        token: process.env["WHATSAPP_TOKEN"],
        phoneNumberId: process.env["WHATSAPP_PHONE_NUMBER_ID"],
      }),
    );
  }
  const approvalNotifier: ApprovalNotifier | undefined =
    approvalNotifiers.length > 1
      ? new CompositeNotifier(approvalNotifiers)
      : approvalNotifiers.length === 1
        ? approvalNotifiers[0]
        : undefined;

  // --- Build orchestrator ---
  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    executionMode,
    onEnqueue,
    approvalNotifier,
    tierStore,
    smbActivityLog,
    credentialResolver: prismaClient
      ? await (async () => {
          const { PrismaCredentialResolver, PrismaConnectionStore } =
            await import("@switchboard/db");
          return new PrismaCredentialResolver(new PrismaConnectionStore(prismaClient));
        })()
      : undefined,
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
  const executionService = new ExecutionService(orchestrator, storage);
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
