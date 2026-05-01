/* eslint-disable max-lines -- bootstrap module: accumulates store wiring,
   middleware, and route registration for the Fastify app. Crossed the 600-line
   guideline when DeploymentLifecycleStore wiring was added (PR #322 / Risk #2).
   Splitting this file (e.g. into a separate `bootstrap/decorate-stores.ts`) is
   tracked as a follow-up — it has architectural reach beyond Risk #2's scope
   and is best done when consolidating the store-wiring pattern across all
   stores at once. */
import Fastify from "fastify";
import crypto from "node:crypto";
import type { FastifyError } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import { setMetrics, evaluate, resolveIdentity } from "@switchboard/core";
import type { StorageContext, PolicyCache, AgentNotifier } from "@switchboard/core";
import { AuditLedger, NoopOperatorAlerter, WebhookOperatorAlerter } from "@switchboard/core";
import type { OperatorAlerter } from "@switchboard/core";
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
import { initSentry, wireSentryErrorHandler } from "./bootstrap/sentry.js";
import { createPromMetrics, metricsRoute } from "./metrics.js";
import { authMiddleware } from "./middleware/auth.js";
import { authRateLimit } from "./middleware/rate-limit.js";
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
    /**
     * True when no auth middleware is enforcing API keys (dev mode).
     * False when at least one source of org-bound auth is configured.
     * Set explicitly by the auth middleware (or by tests/standalone harnesses).
     * Mutation routes consult this flag to decide whether body-supplied
     * organizationId is acceptable.
     */
    authDisabled: boolean;
    approvalRoutingConfig: import("@switchboard/core/approval").ApprovalRoutingConfig;
    storageContext: StorageContext;
    auditLedger: AuditLedger;
    policyCache: PolicyCache;
    redis: Redis | null;
    prisma: import("@switchboard/db").PrismaClient | null;
    governanceProfileStore: import("@switchboard/core").GovernanceProfileStore;
    agentNotifier: AgentNotifier | null;
    conversionBus: import("@switchboard/core").ConversionBus | null;
    ingestionPipeline: import("@switchboard/core").IngestionPipeline | null;
    sessionManager: import("@switchboard/core/sessions").SessionManager | null;
    workflowDeps: import("./bootstrap/workflow-deps.js").WorkflowDeps | null;
    platformIngress: import("@switchboard/core/platform").PlatformIngress;
    platformLifecycle: import("@switchboard/core/platform").PlatformLifecycle;
    deploymentResolver: import("@switchboard/core/platform").DeploymentResolver | null;
    resolvedSkin: { toolFilter: { include: string[]; exclude?: string[] } } | null;
    lifecycleService: import("@switchboard/core").ApprovalLifecycleService | null;
    workTraceStore: import("@switchboard/core/platform").WorkTraceStore | null;
    conversationStateStore: import("@switchboard/core/platform").ConversationStateStore | null;
    deploymentLifecycleStore: import("@switchboard/core/platform").DeploymentLifecycleStore | null;
    executionQueue: import("bullmq").Queue | null;
    executionWorker: import("bullmq").Worker | null;
    simulationExecutor: import("@switchboard/core/skill-runtime").SkillExecutor | null;
    simulationSkill: import("@switchboard/core/skill-runtime").SkillDefinition | null;
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

  // Initialize Sentry before Fastify starts (captures unhandled errors)
  await initSentry();

  const logLevel =
    process.env["LOG_LEVEL"] ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

  const app = Fastify({
    logger: {
      level: logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["stripe-signature"]',
          "body.apiKey",
          "body.password",
          "body.secret",
          "body.token",
          "body.accessToken",
        ],
        censor: "[REDACTED]",
      },
      // Structured JSON logging in production, pretty print in development
      ...(process.env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }),
    },
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

  // Raw body support — needed for Stripe webhook signature verification
  await app.register(rawBody, {
    field: "rawBody",
    global: false, // only on routes that opt in with { config: { rawBody: true } }
    encoding: "utf8",
    runFirst: true,
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

  // Wire Sentry error capture (wraps the error handler above)
  wireSentryErrorHandler(app);

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
  const { storage, ledger, policyCache, governanceProfileStore, prismaClient, redis } =
    await bootstrapStorage(app.log);

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

  // --- Approval routing config (standalone — no orchestrator needed) ---
  const { DEFAULT_ROUTING_CONFIG } = await import("@switchboard/core/approval");
  app.decorate("approvalRoutingConfig", DEFAULT_ROUTING_CONFIG);

  // --- Decorate Fastify with shared instances ---
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("redis", redis);
  app.decorate("prisma", prismaClient);
  app.decorate("governanceProfileStore", governanceProfileStore);
  // Wire ProactiveSender if channel credentials are available
  let agentNotifier: AgentNotifier | null = null;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const whatsappToken = process.env.WHATSAPP_TOKEN;
  const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  const hasAnyCreds = telegramBotToken || whatsappToken || slackBotToken;
  if (hasAnyCreds) {
    const { ProactiveSender } = await import("@switchboard/core/notifications");
    agentNotifier = new ProactiveSender({
      credentials: {
        telegram: telegramBotToken ? { botToken: telegramBotToken } : undefined,
        whatsapp:
          whatsappToken && whatsappPhoneNumberId
            ? { token: whatsappToken, phoneNumberId: whatsappPhoneNumberId }
            : undefined,
        slack: slackBotToken ? { botToken: slackBotToken } : undefined,
      },
    });
  } else {
    app.log.warn(
      "No channel credentials found — agentNotifier disabled. " +
        "Set TELEGRAM_BOT_TOKEN, WHATSAPP_TOKEN+WHATSAPP_PHONE_NUMBER_ID, or SLACK_BOT_TOKEN.",
    );
  }
  app.decorate("agentNotifier", agentNotifier);
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
  let simulationExecutor: import("@switchboard/core/skill-runtime").SkillExecutor | null = null;
  let simulationSkill: import("@switchboard/core/skill-runtime").SkillDefinition | null = null;
  try {
    if (!prismaClient) {
      throw new Error("SkillMode requires DATABASE_URL — prismaClient is null");
    }
    const { bootstrapSkillMode } = await import("./bootstrap/skill-mode.js");
    const skillModeResult = await bootstrapSkillMode({
      prismaClient,
      intentRegistry,
      modeRegistry,
      logger: app.log,
    });
    simulationExecutor = skillModeResult.simulationExecutor;
    simulationSkill = skillModeResult.alexSkill;
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      throw err;
    }
    app.log.error(
      `Failed to register SkillMode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  app.decorate("simulationExecutor", simulationExecutor);
  app.decorate("simulationSkill", simulationSkill);

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

  const operatorAlerter: OperatorAlerter = process.env.OPERATOR_ALERT_WEBHOOK_URL
    ? new WebhookOperatorAlerter({
        webhookUrl: process.env.OPERATOR_ALERT_WEBHOOK_URL,
        headers: process.env.OPERATOR_ALERT_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.OPERATOR_ALERT_WEBHOOK_SECRET}` }
          : undefined,
      })
    : new NoopOperatorAlerter();

  let workTraceStore: import("@switchboard/core/platform").WorkTraceStore | undefined;
  let deploymentResolver: import("@switchboard/core/platform").DeploymentResolver | null = null;
  let conversationStateStore:
    | import("@switchboard/core/platform").ConversationStateStore
    | undefined;
  let deploymentLifecycleStore:
    | import("@switchboard/core/platform").DeploymentLifecycleStore
    | null = null;
  if (prismaClient) {
    const { PrismaWorkTraceStore, PrismaConversationStateStore, PrismaDeploymentLifecycleStore } =
      await import("@switchboard/db");
    const prismaWorkTraceStore = new PrismaWorkTraceStore(prismaClient, {
      auditLedger: ledger,
      operatorAlerter,
    });
    workTraceStore = prismaWorkTraceStore;
    conversationStateStore = new PrismaConversationStateStore(prismaClient, prismaWorkTraceStore);
    deploymentLifecycleStore = new PrismaDeploymentLifecycleStore(
      prismaClient,
      prismaWorkTraceStore,
    );
    const { PrismaDeploymentResolver } = await import("@switchboard/core/platform");
    deploymentResolver = new PrismaDeploymentResolver(prismaClient as never);
  }
  app.decorate("deploymentResolver", deploymentResolver);
  app.decorate("workTraceStore", workTraceStore ?? null);
  app.decorate("conversationStateStore", conversationStateStore ?? null);
  app.decorate("deploymentLifecycleStore", deploymentLifecycleStore ?? null);

  let lifecycleService: import("@switchboard/core").ApprovalLifecycleService | null = null;
  if (prismaClient) {
    const { PrismaLifecycleStore } = await import("@switchboard/db");
    const { ApprovalLifecycleService } = await import("@switchboard/core");
    const lifecycleStore = new PrismaLifecycleStore(prismaClient);
    lifecycleService = new ApprovalLifecycleService({ store: lifecycleStore });
  }
  app.decorate("lifecycleService", lifecycleService);

  const { resolveAuthoritativeDeployment } =
    await import("./bootstrap/platform-deployment-resolver.js");

  const { PrismaBillingEntitlementResolver } =
    await import("./services/billing-entitlement-resolver.js");
  if (process.env["NODE_ENV"] === "production" && !prismaClient) {
    throw new Error(
      "Billing entitlement enforcement requires a Prisma client in production. " +
        "Refusing to start the API without it — this would silently bypass billing on mutating actions.",
    );
  }
  const billingEntitlementResolver = prismaClient
    ? new PrismaBillingEntitlementResolver(prismaClient)
    : undefined;
  if (billingEntitlementResolver) {
    app.decorate("billingEntitlementResolver", billingEntitlementResolver);
  }

  const platformIngress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: platformGovernanceGate,
    deploymentResolver: resolveAuthoritativeDeployment(deploymentResolver),
    traceStore: workTraceStore,
    lifecycleService: lifecycleService ?? undefined,
    entitlementResolver: billingEntitlementResolver,
    auditLedger: ledger,
    operatorAlerter,
  });
  app.decorate("platformIngress", platformIngress);

  // --- Contained workflow mode (creative pipeline, Meta lead intake) ---
  let instantFormAdapter: import("@switchboard/ad-optimizer").InstantFormAdapter | undefined;
  if (prismaClient) {
    const { bootstrapContainedWorkflows } = await import("./bootstrap/contained-workflows.js");
    const result = await bootstrapContainedWorkflows({
      prismaClient,
      intentRegistry,
      modeRegistry,
      platformIngress,
      deploymentResolver,
      logger: app.log,
    });
    instantFormAdapter = result.instantFormAdapter;
  }

  const { PlatformLifecycle } = await import("@switchboard/core/platform");
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry,
    traceStore: workTraceStore ?? {
      persist: async () => {},
      getByWorkUnitId: async () => null,
      update: async () => ({ ok: true as const, trace: {} as never }),
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

    if (redis) {
      await redis.quit();
    }
    if (prismaClient) {
      await prismaClient.$disconnect();
    }
  });

  // Register middleware (idempotency picks up shared redis via app.redis).
  // authDisabled defaults to false so that any code path which forgets to register
  // authMiddleware fails closed rather than silently allowing body-orgId to win.
  // The middleware flips this to true if and only if dev-mode (no API_KEYS, no DB) is detected.
  if (!app.hasDecorator("authDisabled")) {
    app.decorate("authDisabled", false);
  }
  await app.register(authMiddleware);
  await app.register(authRateLimit);
  await app.register(apiVersionPlugin);
  await app.register(idempotencyMiddleware);

  // Billing entitlement gate — blocks unpaid/canceled/past_due/incomplete orgs from
  // mutating actions. Active and trialing subscriptions, plus orgs with the
  // entitlementOverride flag (internal beta / comped pilots), pass through.
  const { billingGuard } = await import("./middleware/billing-guard.js");
  await app.register(billingGuard);

  // Assign a traceId to every request (from X-Request-Id header or auto-generated)
  app.addHook("onRequest", async (request) => {
    const headerVal = request.headers["x-request-id"];
    request.traceId =
      typeof headerVal === "string" && headerVal.trim() ? headerVal.trim() : crypto.randomUUID();
  });

  // Live health check — pings configured backends
  const bootTime = Date.now();
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
        checks["db"] = "ok";
      } catch {
        checks["db"] = "unreachable";
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
      uptime: Math.floor((Date.now() - bootTime) / 1000),
    });
  });

  // Prometheus metrics endpoint (excluded from auth like /health)
  app.get("/metrics", metricsRoute);

  // --- Inngest serve handler (creative pipeline orchestration) ---
  await registerInngest(app, { instantFormAdapter });

  // --- Register all API routes ---
  await registerRoutes(app);

  return app;
}
