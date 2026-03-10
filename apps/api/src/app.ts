import Fastify from "fastify";
import crypto from "node:crypto";
import type { FastifyError } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  LifecycleOrchestrator,
  ExecutionService,
  CompositeNotifier,
  SkinLoader,
  SkinResolver,
  ToolRegistry,
  ProfileResolver,
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
import type { Policy } from "@switchboard/schemas";
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
        { name: "Reports", description: "Clinic and vertical reporting endpoints" },
        { name: "Conversations", description: "Conversation listing and management" },
        { name: "Agents", description: "Agent roster and activity state management" },
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
  let resolvedProfile: ResolvedProfile | null = null;
  if (businessProfile) {
    const profileResolver = new ProfileResolver();
    resolvedProfile = profileResolver.resolve(businessProfile);
    app.log.info({ profileId: businessProfile.id }, "Business profile resolved for agent context");
  }

  // --- Skin loading (optional, controlled by SKIN_ID env var) ---
  let resolvedSkin: ResolvedSkin | null = null;
  const skinId = process.env["SKIN_ID"];
  if (skinId) {
    const skinsDir = new URL("../../../skins", import.meta.url).pathname;
    const skinLoader = new SkinLoader(skinsDir);
    const skinResolver = new SkinResolver();
    const toolRegistry = new ToolRegistry();

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

  // Apply skin governance profile and seed policy overrides
  if (resolvedSkin) {
    await governanceProfileStore.set(null, resolvedSkin.governance.profile);
    app.log.info(
      { profile: resolvedSkin.governance.profile },
      "Skin governance profile set as global default",
    );

    if (resolvedSkin.governance.policyOverrides?.length) {
      const now = new Date();
      for (let i = 0; i < resolvedSkin.governance.policyOverrides.length; i++) {
        const override = resolvedSkin.governance.policyOverrides[i]!;
        const approvalRequirement =
          override.effect === "require_approval"
            ? ((override.effectParams?.["approvalRequirement"] as Policy["approvalRequirement"]) ??
              "standard")
            : undefined;

        await storage.policies.save({
          id: `skin_${resolvedSkin.manifest.id}_${i}`,
          name: override.name,
          description: override.description ?? `Skin policy: ${override.name}`,
          organizationId: null,
          cartridgeId: null,
          priority: 9000 + i,
          active: true,
          rule: override.rule as Policy["rule"],
          effect: override.effect,
          effectParams: override.effectParams ?? {},
          approvalRequirement,
          createdAt: now,
          updatedAt: now,
        });
      }
      app.log.info(
        { count: resolvedSkin.governance.policyOverrides.length },
        "Skin policy overrides seeded",
      );
    }
  }

  // --- ConversionBus wiring (CRM → ads feedback loop) ---
  const { InMemoryConversionBus } = await import("@switchboard/core");
  const conversionBus = new InMemoryConversionBus();

  if (adsWriteProvider && prismaClient) {
    const { CAPIDispatcher, OutcomeTracker } = await import("@switchboard/digital-ads");
    const { PrismaCrmProvider } = await import("@switchboard/db");

    const dispatcher = new CAPIDispatcher({
      adsProvider: adsWriteProvider,
      crmProvider: new PrismaCrmProvider(prismaClient),
      pixelId: process.env["META_PIXEL_ID"] ?? "",
    });
    dispatcher.register(conversionBus);

    const outcomeTracker = new OutcomeTracker();
    outcomeTracker.register(conversionBus);

    app.log.info("ConversionBus wired: CAPIDispatcher + OutcomeTracker registered");
  }

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

  // Resource cleanup on close — order: jobs → worker → queue → Redis → Prisma
  app.addHook("onClose", async () => {
    await stopAllJobs();

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

  // --- Register all API routes ---
  await registerRoutes(app);

  return app;
}
