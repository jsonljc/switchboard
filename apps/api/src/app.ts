import Fastify from "fastify";
import crypto from "node:crypto";
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
import { cartridgesRoutes } from "./routes/cartridges.js";
import { connectionsRoutes } from "./routes/connections.js";
import { organizationsRoutes } from "./routes/organizations.js";
import { dlqRoutes } from "./routes/dlq.js";
import { tokenUsageRoutes } from "./routes/token-usage.js";
import { alertsRoutes } from "./routes/alerts.js";
import { scheduledReportsRoutes } from "./routes/scheduled-reports.js";
import { crmRoutes } from "./routes/crm.js";
import { competenceRoutes } from "./routes/competence.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { inboundWebhooksRoutes } from "./routes/inbound-webhooks.js";
import { inboundMessagesRoutes } from "./routes/inbound-messages.js";
import { smbRoutes } from "./routes/smb.js";
import { governanceRoutes } from "./routes/governance.js";
import { campaignsRoutes } from "./routes/campaigns.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import apiVersionPlugin from "./versioning.js";
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
  CompositeNotifier,
  InMemoryTierStore,
  SmbActivityLog,
  InMemorySmbActivityLogStorage,
  SkinLoader,
  SkinResolver,
  ToolRegistry,
} from "@switchboard/core";
import type {
  StorageContext,
  LedgerStorage,
  PolicyCache,
  ApprovalNotifier,
  TierStore,
  GovernanceProfileStore,
  ResolvedSkin,
} from "@switchboard/core";
import {
  bootstrapDigitalAdsCartridge,
  DEFAULT_DIGITAL_ADS_POLICIES,
  createSnapshotCacheStore,
} from "@switchboard/digital-ads";
import {
  bootstrapQuantTradingCartridge,
  DEFAULT_TRADING_POLICIES,
} from "@switchboard/quant-trading";
import { bootstrapPaymentsCartridge, DEFAULT_PAYMENTS_POLICIES } from "@switchboard/payments";
import { bootstrapCrmCartridge, DEFAULT_CRM_POLICIES } from "@switchboard/crm";
import {
  bootstrapPatientEngagementCartridge,
  DEFAULT_PATIENT_ENGAGEMENT_POLICIES,
} from "@switchboard/patient-engagement";
import { createGuardrailStateStore } from "./guardrail-state/index.js";
import { createExecutionQueue, createExecutionWorker } from "./queue/index.js";
import { startApprovalExpiryJob } from "./jobs/approval-expiry.js";
import { startChainVerificationJob } from "./jobs/chain-verification.js";
import { startDiagnosticScanner } from "./jobs/diagnostic-scanner.js";
import { startScheduledReportJob } from "./jobs/scheduled-reports.js";
import { startTokenRefreshJob } from "./jobs/token-refresh.js";
import { startCadenceRunner } from "./jobs/cadence-runner.js";
import { startTtlCleanupJob } from "./jobs/ttl-cleanup.js";
import { initTelemetry } from "./telemetry/otel-init.js";
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
    tierStore: TierStore;
    smbActivityLog: SmbActivityLog;
    redis: Redis | null;
    executionQueue: Queue | null;
    executionWorker: Worker | null;
    prisma: import("@switchboard/db").PrismaClient | null;
    governanceProfileStore: import("@switchboard/core").GovernanceProfileStore;
    resolvedSkin: ResolvedSkin | null;
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
        {
          name: "Execute",
          description:
            "Single endpoint: propose + conditional execute (EXECUTED | PENDING_APPROVAL | DENIED)",
        },
        {
          name: "Approvals",
          description: "Respond to approval requests and list pending approvals",
        },
        { name: "Simulate", description: "Dry-run action evaluation without side effects" },
        { name: "Policies", description: "CRUD operations for guardrail policies" },
        { name: "Identity", description: "Manage identity specs and role overlays" },
        { name: "Audit", description: "Query audit ledger and verify chain integrity" },
        { name: "Health", description: "Health and readiness checks" },
        { name: "Interpreters", description: "Natural-language action interpretation" },
        { name: "Cartridges", description: "Registered cartridge manifests and metadata" },
        { name: "Connections", description: "Service connection credential management" },
        { name: "Organizations", description: "Organization provisioning and configuration" },
        { name: "DLQ", description: "Dead letter queue for failed inbound messages" },
        { name: "Token Usage", description: "LLM token usage tracking and reporting" },
        { name: "Alerts", description: "Alert rules and notifications" },
        { name: "Scheduled Reports", description: "Automated reporting schedules" },
        { name: "CRM", description: "CRM entity management (contacts, deals, activities)" },
        { name: "Competence", description: "Agent competence assessment and tracking" },
        { name: "Webhooks", description: "Outbound webhook configuration" },
        { name: "Inbound", description: "Inbound webhook receivers (Telegram, Slack, WhatsApp)" },
        { name: "Messages", description: "Inbound message processing and routing" },
        { name: "SMB", description: "SMB-tier pipeline and tier management" },
        { name: "Governance", description: "Governance profiles and emergency halt" },
        { name: "Campaigns", description: "Campaign read operations via digital-ads cartridge" },
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

  // Create storage and orchestrator — with degraded mode fallback
  let storage: StorageContext;
  let ledgerStorage: LedgerStorage;
  let prismaClient: import("@switchboard/db").PrismaClient | null = null;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb, createPrismaStorage, PrismaLedgerStorage } = await import("@switchboard/db");
      prismaClient = getDb() as import("@switchboard/db").PrismaClient;
      await prismaClient.$queryRaw`SELECT 1`; // verify connectivity
      storage = createPrismaStorage(prismaClient as Parameters<typeof createPrismaStorage>[0]);
      ledgerStorage = new PrismaLedgerStorage(
        prismaClient as ConstructorParameters<typeof PrismaLedgerStorage>[0],
      );
    } catch (err) {
      app.log.error(
        { err },
        "DATABASE_URL set but DB unreachable — falling back to in-memory (DEGRADED)",
      );
      storage = createInMemoryStorage();
      ledgerStorage = new InMemoryLedgerStorage();
      prismaClient = null;
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

  // Governance profile store: Prisma-backed when DB available, in-memory fallback
  let governanceProfileStore: GovernanceProfileStore;
  if (prismaClient) {
    const { PrismaGovernanceProfileStore } = await import("@switchboard/db");
    governanceProfileStore = new PrismaGovernanceProfileStore(prismaClient);
  } else {
    governanceProfileStore = new InMemoryGovernanceProfileStore();
  }

  // --- Cartridge credential resolution: DB first, env-var fallback ---
  let adsAccessToken = process.env["META_ADS_ACCESS_TOKEN"];
  let adsAccountId = process.env["META_ADS_ACCOUNT_ID"];
  let stripeSecretKey = process.env["STRIPE_SECRET_KEY"];

  if (prismaClient) {
    try {
      const { PrismaConnectionStore } = await import("@switchboard/db");
      const connStore = new PrismaConnectionStore(prismaClient);

      const adsCon = await connStore.getByService("meta-ads");
      if (adsCon) {
        adsAccessToken =
          (adsCon.credentials as Record<string, string>).accessToken ?? adsAccessToken;
        adsAccountId = (adsCon.credentials as Record<string, string>).adAccountId ?? adsAccountId;
      }

      const stripeCon = await connStore.getByService("stripe");
      if (stripeCon) {
        stripeSecretKey =
          (stripeCon.credentials as Record<string, string>).secretKey ?? stripeSecretKey;
      }
    } catch (err) {
      app.log.warn({ err }, "Failed to load cartridge credentials from DB, using env vars");
    }
  }

  // Register digital-ads cartridge
  const isProd = process.env.NODE_ENV === "production";
  const { cartridge: adsCartridge, interceptors } = await bootstrapDigitalAdsCartridge({
    accessToken: adsAccessToken ?? (isProd ? "" : "mock-token-dev-only"),
    adAccountId: adsAccountId ?? (isProd ? "" : "act_mock_dev_only"),
    requireCredentials: isProd,
    cacheStore: createSnapshotCacheStore(redis ?? undefined),
  });
  storage.cartridges.register(
    "digital-ads",
    new GuardedCartridge(adsCartridge as any, interceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_DIGITAL_ADS_POLICIES);

  // Register quant-trading cartridge
  const { cartridge: tradingCartridge } = await bootstrapQuantTradingCartridge();
  storage.cartridges.register("quant-trading", new GuardedCartridge(tradingCartridge));
  await seedDefaultStorage(storage, DEFAULT_TRADING_POLICIES);

  // Register payments cartridge
  const { cartridge: paymentsCartridge } = await bootstrapPaymentsCartridge({
    secretKey: stripeSecretKey ?? (isProd ? "" : "mock-key-dev-only"),
    requireCredentials: isProd,
  });
  storage.cartridges.register("payments", new GuardedCartridge(paymentsCartridge));
  await seedDefaultStorage(storage, DEFAULT_PAYMENTS_POLICIES);

  // Register CRM cartridge (built-in, no external credentials needed)
  const { cartridge: crmCartridge } = await bootstrapCrmCartridge();
  storage.cartridges.register("crm", new GuardedCartridge(crmCartridge));
  await seedDefaultStorage(storage, DEFAULT_CRM_POLICIES);

  // Register patient-engagement cartridge (uses credential resolver for Google Calendar + Twilio)
  const { cartridge: peCartridge, interceptors: peInterceptors } =
    await bootstrapPatientEngagementCartridge({
      requireCredentials: process.env.NODE_ENV === "production",
    });
  storage.cartridges.register(
    "patient-engagement",
    new GuardedCartridge(peCartridge, peInterceptors),
  );
  await seedDefaultStorage(storage, DEFAULT_PATIENT_ENGAGEMENT_POLICIES);

  // --- Skin loading (optional, controlled by SKIN_ID env var) ---
  let resolvedSkin: ResolvedSkin | null = null;
  const skinId = process.env["SKIN_ID"];
  if (skinId) {
    const skinsDir = new URL("../../../skins", import.meta.url).pathname;
    const skinLoader = new SkinLoader(skinsDir);
    const skinResolver = new SkinResolver();
    const toolRegistry = new ToolRegistry();

    // Register all cartridge manifests in the tool registry
    for (const cartridgeId of storage.cartridges.list()) {
      const cartridge = storage.cartridges.get(cartridgeId);
      if (cartridge) {
        toolRegistry.registerCartridge(cartridgeId, cartridge.manifest);
      }
    }

    const skin = await skinLoader.load(skinId);
    resolvedSkin = skinResolver.resolve(skin, toolRegistry);
    app.log.info(
      { skinId, tools: resolvedSkin.tools.length, profile: resolvedSkin.governance.profile },
      `Skin "${skinId}" loaded: ${resolvedSkin.tools.length} tools, profile=${resolvedSkin.governance.profile}`,
    );
  }

  let queue: Queue | null = null;
  let worker: Worker | null = null;
  let onEnqueue: ((envelopeId: string) => Promise<void>) | undefined;
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

  // Wire approval notifiers from env vars
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

  // SMB tier store and activity log
  let tierStore: TierStore | undefined;
  let smbActivityLog: SmbActivityLog | undefined;
  if (prismaClient) {
    const { PrismaTierStore } = await import("@switchboard/db");
    const { PrismaSmbActivityLogStorage } = await import("@switchboard/db");
    tierStore = new PrismaTierStore(prismaClient);
    smbActivityLog = new SmbActivityLog(new PrismaSmbActivityLogStorage(prismaClient));
  } else {
    tierStore = new InMemoryTierStore();
    smbActivityLog = new SmbActivityLog(new InMemorySmbActivityLogStorage());
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

  // Start approval expiry background job
  const stopExpiryJob = startApprovalExpiryJob({ storage, ledger, logger: app.log });

  // Start daily audit chain verification job
  const stopChainVerify = startChainVerificationJob({ ledger, logger: app.log });

  // Start diagnostic scanner + scheduled report jobs (require DB)
  const stopDiagnosticScanner = prismaClient
    ? startDiagnosticScanner({ prisma: prismaClient, storageContext: storage, logger: app.log })
    : () => {};
  const stopScheduledReports = prismaClient
    ? startScheduledReportJob({ prisma: prismaClient, storageContext: storage, logger: app.log })
    : () => {};
  const stopTokenRefresh = prismaClient
    ? startTokenRefreshJob({ prisma: prismaClient, logger: app.log })
    : () => {};
  const stopTtlCleanup = prismaClient
    ? startTtlCleanupJob({ prisma: prismaClient, logger: app.log })
    : () => {};

  // Start cadence cron runner (evaluates pending cadences on schedule)
  const stopCadenceRunner = startCadenceRunner({
    storageContext: storage,
    intervalMs: 60_000,
    logger: app.log,
  });

  // Decorate Fastify with shared instances
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

  // Resource cleanup on close — order: worker → queue → Redis → Prisma
  app.addHook("onClose", async () => {
    stopExpiryJob();
    stopChainVerify();
    stopDiagnosticScanner();
    stopScheduledReports();
    stopTokenRefresh();
    stopTtlCleanup();
    stopCadenceRunner();

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
  await app.register(cartridgesRoutes, { prefix: "/api/cartridges" });
  await app.register(connectionsRoutes, { prefix: "/api/connections" });
  await app.register(organizationsRoutes, { prefix: "/api/organizations" });
  await app.register(dlqRoutes, { prefix: "/api/dlq" });
  await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });
  await app.register(alertsRoutes, { prefix: "/api/alerts" });
  await app.register(scheduledReportsRoutes, { prefix: "/api/scheduled-reports" });
  await app.register(crmRoutes, { prefix: "/api/crm" });
  await app.register(competenceRoutes, { prefix: "/api/competence" });
  await app.register(webhooksRoutes, { prefix: "/api/webhooks" });
  await app.register(inboundWebhooksRoutes, { prefix: "/api/inbound" });
  await app.register(inboundMessagesRoutes, { prefix: "/api/messages" });
  await app.register(smbRoutes, { prefix: "/api/smb" });
  await app.register(governanceRoutes, { prefix: "/api/governance" });
  await app.register(campaignsRoutes, { prefix: "/api/campaigns" });

  return app;
}
