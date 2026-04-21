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
  evaluate,
  resolveIdentity,
} from "@switchboard/core";
import type {
  StorageContext,
  PolicyCache,
  ApprovalNotifier,
  AgentNotifier,
} from "@switchboard/core";
import { AuditLedger } from "@switchboard/core";
import {
  IntentRegistry,
  ExecutionModeRegistry,
  GovernanceGate,
  CartridgeMode,
  PlatformIngress,
  registerCartridgeIntents,
} from "@switchboard/core/platform";
import type { CartridgeManifestForRegistration } from "@switchboard/core/platform";
import { initTelemetry } from "./telemetry/otel-init.js";
import { createPromMetrics, metricsRoute } from "./metrics.js";
import { authMiddleware } from "./middleware/auth.js";
import apiVersionPlugin from "./versioning.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { bootstrapStorage } from "./bootstrap/storage.js";
import { ensureSystemIdentity } from "./bootstrap/system-identity.js";
import { registerRoutes } from "./bootstrap/routes.js";
import { registerInngest } from "./bootstrap/inngest.js";
import { registerSwagger } from "./bootstrap/swagger.js";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    orchestrator: LifecycleOrchestrator;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    executionService: ExecutionService;
    redis: Redis | null;
    prisma: import("@switchboard/db").PrismaClient | null;
    governanceProfileStore: import("@switchboard/core").GovernanceProfileStore;
    agentNotifier: AgentNotifier | null;
    conversionBus: import("@switchboard/core").ConversionBus | null;
    ingestionPipeline: import("@switchboard/core").IngestionPipeline | null;
    sessionManager: import("@switchboard/core/sessions").SessionManager | null;
    workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null;
    schedulerService: import("@switchboard/core").SchedulerService | null;
    operatorDeps: import("./bootstrap/operator-deps.js").OperatorDeps | null;
    platformIngress: import("@switchboard/core/platform").PlatformIngress;
    platformLifecycle: import("@switchboard/core/platform").PlatformLifecycle;
    deploymentResolver: import("@switchboard/core/platform").DeploymentResolver | null;
    resolvedSkin: { toolFilter: { include: string[]; exclude?: string[] } } | null;
    executionQueue: import("bullmq").Queue | null;
    executionWorker: import("bullmq").Worker | null;
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
    prismaClient,
    redis,
  } = await bootstrapStorage(app.log);

  if (prismaClient) {
    await ensureSystemIdentity(prismaClient);
  }

  // --- ConversionBus wiring ---
  const { createConversionPipelineMetrics, setOutboxBacklogSampler } = await import("./metrics.js");
  const conversionMetrics = createConversionPipelineMetrics();
  const { bootstrapConversionBus } = await import("./bootstrap/conversion-bus-bootstrap.js");
  const conversionBusHandle = await bootstrapConversionBus({
    redis,
    prisma: prismaClient,
    logger: app.log,
    metrics: conversionMetrics,
  });
  const conversionBus = conversionBusHandle.bus;
  conversionBusHandle.start();

  if (prismaClient) {
    setOutboxBacklogSampler(async () => {
      return prismaClient.outboxEvent.count({ where: { status: "pending" } });
    });
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
  let ingestionPipeline: import("@switchboard/core").IngestionPipeline | null = null;
  if (conversationDeps && knowledgeStore) {
    const { IngestionPipeline } = await import("@switchboard/core");

    ingestionPipeline = new IngestionPipeline({
      store: knowledgeStore,
      embedding: conversationDeps.embeddingAdapter,
    });
  }

  app.decorate("ingestionPipeline", ingestionPipeline);

  // --- Session runtime bootstrap (optional — requires DATABASE_URL + SESSION_TOKEN_SECRET) ---
  let sessionManager: import("@switchboard/core/sessions").SessionManager | null = null;
  if (prismaClient) {
    const { bootstrapSessionRuntime } = await import("./bootstrap/session-bootstrap.js");
    const sessionResult = await bootstrapSessionRuntime(prismaClient, app.log);
    sessionManager = sessionResult?.sessionManager ?? null;
  }
  app.decorate("sessionManager", sessionManager);

  // --- Workflow engine bootstrap (optional — requires DATABASE_URL) ---
  let workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null = null;
  if (prismaClient) {
    const { buildWorkflowDeps } = await import("./bootstrap/workflow-deps.js");
    const stepPolicyBridge: import("@switchboard/core").StepExecutorPolicyBridge = {
      evaluate: async () => ({ approved: true, requiresApproval: false }),
    };
    const stepActionExecutor: import("@switchboard/core").StepExecutorActionExecutor = {
      execute: async (action) => ({
        actionType: action.actionType,
        success: false,
        blockedByPolicy: false,
        error: `No handler registered for action type: ${action.actionType}`,
      }),
    };
    workflowDeps = buildWorkflowDeps(prismaClient, stepActionExecutor, stepPolicyBridge);
    if (workflowDeps) {
      app.log.info("Workflow engine bootstrapped");
    }
  }
  app.decorate("workflowDeps", workflowDeps);

  // --- Scheduler service bootstrap (optional — requires DATABASE_URL + REDIS_URL + workflow engine) ---
  const redisUrl = process.env["REDIS_URL"];
  let schedulerDeps: import("./bootstrap/scheduler-deps.js").SchedulerDeps | null = null;
  if (prismaClient && redisUrl && workflowDeps) {
    const { buildSchedulerDeps } = await import("./bootstrap/scheduler-deps.js");
    schedulerDeps = buildSchedulerDeps(prismaClient, redisUrl, workflowDeps.workflowEngine);
    if (schedulerDeps) {
      app.log.info("Scheduler service bootstrapped");
    }
  }
  app.decorate("schedulerService", schedulerDeps?.service ?? null);

  // --- Operator deps (stubbed — domain code removed) ---
  app.decorate("operatorDeps", null as import("./bootstrap/operator-deps.js").OperatorDeps | null);

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

  // --- Marketplace trust adapter (optional — requires DATABASE_URL) ---
  let trustAdapter: import("@switchboard/core").TrustScoreAdapter | null = null;
  if (prismaClient) {
    try {
      const { PrismaTrustScoreStore } = await import("@switchboard/db");
      const { TrustScoreEngine, TrustScoreAdapter } = await import("@switchboard/core");
      const trustStore = new PrismaTrustScoreStore(prismaClient);
      const trustEngine = new TrustScoreEngine(trustStore);
      const resolver: import("@switchboard/core").PrincipalListingResolver = async (
        principalId,
        actionType,
      ) => {
        // Convention: marketplace agent principalIds start with "listing:"
        if (!principalId.startsWith("listing:")) return null;
        const listingId = principalId.slice("listing:".length);
        return { listingId, taskCategory: actionType ?? "default" };
      };
      trustAdapter = new TrustScoreAdapter(trustEngine, resolver);
    } catch (err) {
      app.log.warn(
        `Failed to initialize trust adapter: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- Build orchestrator ---
  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    guardrailStateStore,
    policyCache,
    governanceProfileStore,
    approvalNotifier,
    trustAdapter,
    credentialResolver: prismaClient
      ? await (async () => {
          const { PrismaCredentialResolver, PrismaConnectionStore } =
            await import("@switchboard/db");
          return new PrismaCredentialResolver(new PrismaConnectionStore(prismaClient));
        })()
      : undefined,
  });

  // --- Decorate Fastify with shared instances ---
  const executionService = new ExecutionService(orchestrator, storage);
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("executionService", executionService);
  app.decorate("redis", redis);
  app.decorate("prisma", prismaClient);
  app.decorate("governanceProfileStore", governanceProfileStore);
  app.decorate("agentNotifier", null as AgentNotifier | null);
  app.decorate("conversionBus", conversionBus);

  // --- PlatformIngress wiring ---
  const intentRegistry = new IntentRegistry();
  const cartridgeManifests: CartridgeManifestForRegistration[] = [];
  for (const cartridgeId of storage.cartridges.list()) {
    const cartridge = storage.cartridges.get(cartridgeId);
    if (!cartridge) continue;
    const manifest = cartridge.manifest;
    if (!manifest.actions || manifest.actions.length === 0) continue;
    cartridgeManifests.push({
      id: manifest.id,
      actions: manifest.actions.map((a) => ({
        name: a.actionType.startsWith(`${manifest.id}.`)
          ? a.actionType.slice(manifest.id.length + 1)
          : a.actionType,
        description: a.description,
        riskCategory: a.baseRiskCategory,
      })),
    });
  }
  registerCartridgeIntents(intentRegistry, cartridgeManifests);

  const modeRegistry = new ExecutionModeRegistry();
  modeRegistry.register(new CartridgeMode({ cartridgeRegistry: storage.cartridges }));

  // --- SkillMode registration (skill-backed deployments) ---
  try {
    if (!prismaClient) {
      throw new Error("SkillMode requires DATABASE_URL — prismaClient is null");
    }
    const { bootstrapSkillMode } = await import("./bootstrap/skill-mode.js");
    await bootstrapSkillMode({
      prismaClient,
      intentRegistry,
      modeRegistry,
      logger: app.log,
    });
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      throw err;
    }
    app.log.error(
      `Failed to register SkillMode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const platformGovernanceGate = new GovernanceGate({
    evaluate,
    resolveIdentity,
    loadPolicies: async (orgId) => storage.policies.listActive({ organizationId: orgId }),
    loadIdentitySpec: async (actorId) => {
      const spec = await storage.identity.getSpecByPrincipalId(actorId);
      if (!spec) throw new Error(`Identity spec not found: ${actorId}`);
      const overlays = await storage.identity.listOverlaysBySpecId(spec.id);
      return { spec, overlays };
    },
    loadCartridge: async (cartridgeId) =>
      storage.cartridges.get(cartridgeId) as
        | import("@switchboard/core/platform").GovernanceCartridge
        | null,
    getGovernanceProfile: async (orgId) => {
      if (!governanceProfileStore) return null;
      return governanceProfileStore.get(orgId);
    },
  });

  let workTraceStore: import("@switchboard/core/platform").WorkTraceStore | undefined;
  let deploymentResolver: import("@switchboard/core/platform").DeploymentResolver | null = null;
  if (prismaClient) {
    const { PrismaWorkTraceStore } = await import("@switchboard/db");
    workTraceStore = new PrismaWorkTraceStore(prismaClient);
    const { PrismaDeploymentResolver } = await import("@switchboard/core/platform");
    deploymentResolver = new PrismaDeploymentResolver(prismaClient as never);
  }
  app.decorate("deploymentResolver", deploymentResolver);

  const { resolveAuthoritativeDeployment } =
    await import("./bootstrap/platform-deployment-resolver.js");

  const platformIngress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: platformGovernanceGate,
    deploymentResolver: resolveAuthoritativeDeployment(deploymentResolver),
    traceStore: workTraceStore,
  });
  app.decorate("platformIngress", platformIngress);

  const { PlatformLifecycle } = await import("@switchboard/core/platform");
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry,
    traceStore: workTraceStore ?? {
      persist: async () => {},
      getByWorkUnitId: async () => null,
      update: async () => {},
      getByIdempotencyKey: async () => null,
    },
    ledger,
    trustAdapter: trustAdapter ?? null,
    selfApprovalAllowed: !!process.env.ALLOW_SELF_APPROVAL,
    approvalRateLimit: process.env.APPROVAL_RATE_LIMIT_MAX
      ? {
          maxApprovals: parseInt(process.env.APPROVAL_RATE_LIMIT_MAX, 10),
          windowMs: parseInt(process.env.APPROVAL_RATE_LIMIT_WINDOW_MS ?? "60000", 10),
        }
      : null,
  });
  app.decorate("platformLifecycle", platformLifecycle);

  // Resource cleanup on close — order: outbox → scheduler → Redis → Prisma
  app.addHook("onClose", async () => {
    conversionBusHandle.stop();

    if (schedulerDeps) {
      await schedulerDeps.cleanup();
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

  // --- Inngest serve handler (creative pipeline orchestration) ---
  await registerInngest(app);

  // --- Register all API routes ---
  await registerRoutes(app);

  return app;
}
