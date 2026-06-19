/* eslint-disable max-lines -- bootstrap module: accumulates store wiring,
   middleware, and route registration for the Fastify app. Crossed the 600-line
   guideline when DeploymentLifecycleStore wiring was added (PR #322 / Risk #2).
   Splitting this file (e.g. into a separate `bootstrap/decorate-stores.ts`) is
   tracked as a follow-up — it has architectural reach beyond Risk #2's scope
   and is best done when consolidating the store-wiring pattern across all
   stores at once. */
import Fastify from "fastify";
import crypto from "node:crypto";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import formbody from "@fastify/formbody";
import { setMetrics, evaluate, resolveIdentity } from "@switchboard/core";
import type { StorageContext, PolicyCache, AgentNotifier } from "@switchboard/core";
import { AuditLedger } from "@switchboard/core";
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
import { installErrorHandler } from "./bootstrap/error-handler.js";
import { initSentry, wireSentryErrorHandler } from "./bootstrap/sentry.js";
import { createPromMetrics, metricsRoute } from "./metrics.js";
import { resolveWhatsAppSendToken } from "./lib/whatsapp-send-token.js";
import { authMiddleware } from "./middleware/auth.js";
import { authRateLimit } from "./middleware/rate-limit.js";
import apiVersionPlugin from "./versioning.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { buildDevAuthFallback } from "./utils/auth-fallback.js";
import { bootstrapStorage } from "./bootstrap/storage.js";
import { ensureSystemIdentity } from "./bootstrap/system-identity.js";
import { registerRoutes } from "./bootstrap/routes.js";
import { selectOperatorAlerter } from "./bootstrap/select-operator-alerter.js";
import { registerInngest } from "./bootstrap/inngest.js";
import { registerSwagger } from "./bootstrap/swagger.js";
import { wireMetricsProvider } from "./bootstrap/wire-metrics.js";
import { assertSafeSelfApprovalEnv } from "./bootstrap/self-approval-env.js";
import type { StripeConnectClient } from "./payments/stripe-connect-payment-adapter.js";
import type { Redis } from "ioredis";

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
    reportCacheStore?: import("@switchboard/core/reports").ReportCacheStore;
    reportStores?: import("@switchboard/core/reports").ReportStores;
    baselineStore?: import("@switchboard/core/reports").BaselineStore;
    disqualificationHook?: Pick<
      import("@switchboard/core").DisqualificationResolutionHook,
      "confirm" | "dismiss"
    > | null;
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
  // Fail fast on prod-unsafe env before any I/O. Mirrors the dashboard's
  // assertSafeDashboardAuthEnv(): a production boot with ALLOW_SELF_APPROVAL
  // enabled but unacknowledged crashes here rather than silently disabling
  // four-eyes approval (security audit 2026-06-10, F7).
  assertSafeSelfApprovalEnv();

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

  // application/x-www-form-urlencoded body parsing — Meta's Data Deletion
  // callback POSTs `signed_request` as form data.
  await app.register(formbody);

  // OpenAPI documentation + optional Swagger UI
  await registerSwagger(app);

  // Global error handler — consistent error format. In production, 5xx messages
  // are scrubbed; in development, the original message + stack pass through.
  installErrorHandler(app);

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

  // Internal service secret check (F-15) — INTERNAL_API_SECRET authenticates the
  // chat-to-API ingress hop and the chat-approval bridge. Without it, every managed-channel
  // inbound 503s silently. Hard-fail in production, warn otherwise (mirrors the chat boot
  // guard in apps/chat/src/startup-checks.ts).
  if (process.env["DATABASE_URL"] && !process.env["INTERNAL_API_SECRET"]) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "INTERNAL_API_SECRET is required in production when DATABASE_URL is set. " +
          "It authenticates the chat-to-API ingress hop and the chat-approval bridge. " +
          "Set it to a strong random secret (min 32 chars), the same value on the chat service.",
      );
    }
    app.log.warn(
      "INTERNAL_API_SECRET is not set but DATABASE_URL is configured. " +
        "The chat-to-API ingress hop and chat-approval bridge will reject every request (503). " +
        "Set INTERNAL_API_SECRET to a strong random secret (min 32 chars), same value as chat.",
    );
  }

  // --- Bootstrap storage layer ---
  const { storage, ledger, policyCache, governanceProfileStore, prismaClient, redis } =
    await bootstrapStorage(app.log);

  if (process.env["DATABASE_URL"] && !prismaClient) {
    console.error(
      "[api] DATABASE_URL is set but the database is not reachable.\n" +
        "      Could not establish a connection during storage bootstrap.\n" +
        "      Is Postgres running? Run `pnpm worktree:init` to verify and apply migrations.",
    );
    process.exit(1);
  }

  if (prismaClient) {
    try {
      await Promise.race([
        prismaClient.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("DB sanity check timed out after 3s")), 3000),
        ),
      ]);
    } catch (err) {
      console.error(
        "[api] DATABASE_URL is set but the database is not reachable.\n" +
          `      ${err instanceof Error ? err.message : String(err)}\n` +
          "      Is Postgres running? Run `pnpm worktree:init` to verify and apply migrations.",
      );
      process.exit(1);
    }

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

  // Build ContextBuilder for outcome-informed skill context (Task 8 / agent-infra-parity).
  // Requires prismaClient + conversationDeps (provides KnowledgeRetriever) + knowledgeStore.
  // PrismaDeploymentMemoryStore and PrismaInteractionSummaryStore are stateless wrappers over
  // prismaClient — constructing them here rather than reusing shared instances is equivalent
  // because the invariant is "same prismaClient → same DB rows", not shared in-memory state.
  let contextBuilder: import("@switchboard/core").ContextBuilder | undefined;
  if (prismaClient && conversationDeps && knowledgeStore) {
    const { ContextBuilder } = await import("@switchboard/core");
    const {
      PrismaDeploymentMemoryStore,
      PrismaInteractionSummaryStore,
      PrismaDeploymentMemoryEvidenceStore,
    } = await import("@switchboard/db");
    contextBuilder = new ContextBuilder({
      knowledgeRetriever: conversationDeps.retriever,
      deploymentMemoryStore: new PrismaDeploymentMemoryStore(prismaClient),
      interactionSummaryStore: new PrismaInteractionSummaryStore(prismaClient),
      // PR-3.2e: evidenceStore powers the multi-booking surfacing branch
      // when AgentDeployment.inputConfig.outcomePatterns.pilotMode = true.
      evidenceStore: new PrismaDeploymentMemoryEvidenceStore(prismaClient),
    });
    app.log.info("ContextBuilder wired (outcome-informed skill context)");
  }

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
  if (prismaClient) wireMetricsProvider(app, prismaClient);
  app.decorate("governanceProfileStore", governanceProfileStore);
  // Wire ProactiveSender if channel credentials are available
  let agentNotifier: AgentNotifier | null = null;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  // Canonical send-token resolution: WHATSAPP_ACCESS_TOKEN, falling back to the
  // WHATSAPP_TOKEN alias, so this notifier and the proactive workflows agree on one key.
  const whatsappToken = resolveWhatsAppSendToken();
  const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  const hasAnyCreds = telegramBotToken || whatsappToken || slackBotToken;
  if (hasAnyCreds) {
    const { ProactiveSender, isWithinWhatsAppWindow } =
      await import("@switchboard/core/notifications");
    // WhatsApp 24h customer-care window gate. ProactiveSender invokes this only on
    // the WhatsApp path, where `recipient` is the destination phone (the
    // ConversationState.principalId carried as destinationPrincipalId). Derive the
    // last-inbound timestamp from the conversation state keyed by that phone; a
    // missing row (no inbound on record) is treated as OUTSIDE the window
    // (isWithinWhatsAppWindow(null) === false → fail closed). Without a DB there is
    // no inbound history to consult, so we also fail closed. The send then throws
    // WhatsAppWindowClosedError instead of silently dropping the message.
    const isWithinWindow = async (recipient: string): Promise<boolean> => {
      if (!prismaClient) return false;
      const row = await prismaClient.conversationState.findFirst({
        where: { principalId: recipient, channel: "whatsapp" },
        orderBy: { lastInboundAt: "desc" },
        select: { lastInboundAt: true },
      });
      return isWithinWhatsAppWindow(row?.lastInboundAt ?? null);
    };
    agentNotifier = new ProactiveSender({
      credentials: {
        telegram: telegramBotToken ? { botToken: telegramBotToken } : undefined,
        whatsapp:
          whatsappToken && whatsappPhoneNumberId
            ? { token: whatsappToken, phoneNumberId: whatsappPhoneNumberId }
            : undefined,
        slack: slackBotToken ? { botToken: slackBotToken } : undefined,
      },
      isWithinWindow,
    });
  } else {
    app.log.warn(
      "No channel credentials found — agentNotifier disabled. " +
        "Set TELEGRAM_BOT_TOKEN, WHATSAPP_ACCESS_TOKEN+WHATSAPP_PHONE_NUMBER_ID, or SLACK_BOT_TOKEN.",
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

  // --- OperatorAlerter + WorkTraceStore (moved before SkillMode so workTraceStore
  //     can be threaded into PrismaOpportunityStore inside bootstrapSkillMode) ---
  // Single source of truth for the operator alerter; the same instance is
  // threaded to the WorkTraceStore, PlatformIngress, and the Inngest async
  // path (registerInngest) below, so every failure path shares one alerter (D9-F1).
  const operatorAlerter: OperatorAlerter = selectOperatorAlerter(process.env);

  let workTraceStore: import("@switchboard/db").PrismaWorkTraceStore | undefined;
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

  // --- SkillMode registration (skill-backed deployments) ---
  let simulationExecutor: import("@switchboard/core/skill-runtime").SkillExecutor | null = null;
  let simulationSkill: import("@switchboard/core/skill-runtime").SkillDefinition | null = null;
  let skillModeConsentService: import("@switchboard/core").ConsentService | null = null;
  let skillModeContactConsentReader: import("@switchboard/core").ContactConsentReader | null = null;

  // Agent→agent delegation submitter. PlatformIngress is constructed further below,
  // so this is late-bound: the delegate tool only calls submitChildWork at runtime
  // (during an Alex conversation), by which point submitChildWorkRef is assigned.
  // Adapts the platform SubmitWorkResponse to the core ChildWorkSubmitter port.
  let submitChildWorkRef:
    | ((
        req: import("@switchboard/core/platform").ChildWorkRequest,
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse>)
    | undefined;
  const { createChildWorkSubmitter } = await import("./bootstrap/delegation-submitter.js");
  const childWorkSubmitter = createChildWorkSubmitter(() => submitChildWorkRef);

  // Per-org PaymentPort factory (PR 1A-4d). Constructed BEFORE bootstrapSkillMode so the
  // SAME instance backs both Alex's deposit-link tool and the payments webhook: the Noop
  // adapter's in-process issued map only round-trips when one instance is shared. Stripe-first,
  // Noop fail-closed; never a global env secret.
  let paymentPortFactory:
    | import("./bootstrap/payment-port-factory.js").PaymentPortFactory
    | undefined;
  if (prismaClient) {
    const { createPaymentPortFactory, DEFAULT_PAYMENT_REDIRECT_BASE_URL } =
      await import("./bootstrap/payment-port-factory.js");
    // Pilot-global patient-payment-page origin (Fork 2): a dedicated PAYMENT_PUBLIC_URL
    // (the documented per-origin hook), falling back to the existing DASHBOARD_URL (the
    // pages ARE dashboard pages) then the localhost dev default. `||` (not `??`) so a
    // blank env value falls through to the next source instead of yielding an empty origin.
    const paymentRedirectBaseUrl =
      process.env.PAYMENT_PUBLIC_URL ||
      process.env.DASHBOARD_URL ||
      DEFAULT_PAYMENT_REDIRECT_BASE_URL;
    paymentPortFactory = createPaymentPortFactory({
      prismaClient,
      logger: app.log,
      paymentRedirectBaseUrl,
    });
  }

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
      contextBuilder,
      childWorkSubmitter,
      paymentPortFactory,
    });
    simulationExecutor = skillModeResult.simulationExecutor;
    simulationSkill = skillModeResult.alexSkill;
    skillModeConsentService = skillModeResult.consentService;
    skillModeContactConsentReader = skillModeResult.contactConsentReader;
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
      storage.cartridges.get(cartridgeId) as unknown as
        | import("@switchboard/core/platform").GovernanceCartridge
        | null,
    getGovernanceProfile: async (orgId) => {
      if (!governanceProfileStore) return null;
      return governanceProfileStore.get(orgId);
    },
  });

  let lifecycleService: import("@switchboard/core").ApprovalLifecycleService | null = null;
  if (prismaClient) {
    const { PrismaLifecycleStore } = await import("@switchboard/db");
    const { ApprovalLifecycleService } = await import("@switchboard/core");
    const lifecycleStore = new PrismaLifecycleStore(prismaClient);
    lifecycleService = new ApprovalLifecycleService({ store: lifecycleStore });
  }
  app.decorate("lifecycleService", lifecycleService);

  // Recommendations store — Prisma in production, undefined when no DB (dev w/o DB).
  // The /api/recommendations route 503s when this is missing.
  if (prismaClient) {
    const { PrismaRecommendationStore } = await import("@switchboard/db");
    const recommendationStore = new PrismaRecommendationStore(prismaClient);
    app.decorate("recommendationStore", recommendationStore);
  }

  // OrgAgentEnablement store — Prisma in production, undefined when no DB.
  // The /api/dashboard/agents route 503s when this is missing.
  if (prismaClient) {
    const { PrismaOrgAgentEnablementStore } = await import("@switchboard/db");
    const orgAgentEnablementStore = new PrismaOrgAgentEnablementStore(prismaClient);
    app.decorate("orgAgentEnablementStore", orgAgentEnablementStore);
  }

  // Per-org PaymentPort factory, constructed above and shared with Alex's deposit-link
  // tool so the Noop issued map round-trips with the webhook's retrievePayment.
  // The /api/webhooks/payments/webhook route 503s when this is missing.
  if (paymentPortFactory) {
    app.decorate("paymentPortFactory", paymentPortFactory);
  }

  // Native Stripe Connect webhook verifier (platform-level endpoint, one signing
  // secret). constructEvent verifies the Stripe-Signature over the raw body and
  // returns the typed event (event.account carries the connected account). Gated on
  // both the platform key and the Connect endpoint secret; absent either, the
  // /api/webhooks/payments/webhook route 503s (fail-closed, no live verification).
  {
    const connectWebhookSecret = process.env["STRIPE_CONNECT_WEBHOOK_SECRET"];
    const stripeSecretKey = process.env["STRIPE_SECRET_KEY"];
    if (connectWebhookSecret && stripeSecretKey) {
      // Reuse the platform Stripe singleton (getStripe is keyed on STRIPE_SECRET_KEY,
      // guaranteed present by the guard above). constructEvent uses only the signing
      // secret for its HMAC, so the client is just the carrier for the verify method;
      // reusing the singleton avoids a second client and a duplicate apiVersion pin.
      const { getStripe } = await import("./services/stripe-service.js");
      const { verifyConnectWebhookSignature } =
        await import("./payments/stripe-connect-payment-adapter.js");
      const platformClient = getStripe() as unknown as StripeConnectClient;
      app.decorate("paymentWebhookVerifier", (rawBodyStr: string | Buffer, signature: string) =>
        verifyConnectWebhookSignature(platformClient, rawBodyStr, signature, connectWebhookSecret),
      );
    } else {
      app.log.info(
        "Stripe Connect webhook verifier not configured (need STRIPE_SECRET_KEY + STRIPE_CONNECT_WEBHOOK_SECRET); payments webhook will 503",
      );
    }
  }

  // Report cache store + report projection stores for /api/dashboard/reports
  if (prismaClient) {
    const {
      PrismaReportCacheStore,
      PrismaRevenueStore,
      PrismaBookingStore,
      PrismaOpportunityStore,
      PrismaConversionRecordStore,
      PrismaRecommendationStore: PrismaRecStore,
      PrismaConversationThreadStore,
      PrismaContactStore: PrismaContactStoreForReports,
      PrismaReceiptStore: PrismaReceiptStoreForReports,
      PrismaReceiptedBookingStore,
    } = await import("@switchboard/db");

    app.decorate("reportCacheStore", new PrismaReportCacheStore(prismaClient));

    const receiptedBookingViewStore = new PrismaReceiptedBookingStore(prismaClient);
    const reportStores = {
      revenue: new PrismaRevenueStore(prismaClient),
      bookings: new PrismaBookingStore(prismaClient),
      opportunities: new PrismaOpportunityStore(prismaClient),
      conversions: new PrismaConversionRecordStore(prismaClient),
      recommendations: new PrismaRecStore(prismaClient),
      conversations: new PrismaConversationThreadStore(prismaClient),
      deployment: {
        getAlexSlug: async (orgId: string) => {
          const dep = await prismaClient.agentDeployment.findFirst({
            where: { organizationId: orgId },
            include: { listing: { select: { slug: true } } },
          });
          return dep?.listing?.slug ?? null;
        },
      },
      orgConfig: {
        getStripePriceId: async (orgId: string) => {
          const config = await prismaClient.organizationConfig.findUnique({
            where: { id: orgId },
            select: { stripePriceId: true },
          });
          return config?.stripePriceId ?? null;
        },
      },
      contacts: new PrismaContactStoreForReports(prismaClient),
      receipts: new PrismaReceiptStoreForReports(prismaClient),
      receiptedBookings: {
        listForCohort: (input: { orgId: string; from: Date; to: Date }) =>
          receiptedBookingViewStore.listForCohort(input.orgId, input.from, input.to),
      },
    };
    app.decorate("reportStores", reportStores);

    const { PrismaBaselineStore } = await import("@switchboard/db");
    app.decorate("baselineStore", new PrismaBaselineStore(prismaClient));
  }

  // Greeting signal store — Prisma in production, undefined when no DB.
  // The /api/dashboard/agents/:agentKey/greeting route 500s when this is missing.
  if (prismaClient) {
    const { PrismaGreetingSignalStore } = await import("@switchboard/db");
    app.decorate("greetingSignalStore", new PrismaGreetingSignalStore(prismaClient));
  }

  // Decision feed deps — Prisma stores merged by /api/dashboard/[agents/:key/]decisions
  // and the /api/dashboard/contacts/:id detail route (D1.5). Skipped when no DB;
  // routes return 503 ("dependencies not wired").
  if (prismaClient) {
    const {
      PrismaContactStore,
      PrismaHandoffStore,
      PrismaConversationThreadStore,
      PrismaOpportunityStore,
      PrismaRevenueStore,
      PrismaTriggerStore,
    } = await import("@switchboard/db");
    app.decorate("contactStore", new PrismaContactStore(prismaClient));
    app.decorate("handoffStore", new PrismaHandoffStore(prismaClient));
    app.decorate("threadStore", new PrismaConversationThreadStore(prismaClient));
    app.decorate("opportunityStore", new PrismaOpportunityStore(prismaClient));
    app.decorate("revenueEventStore", new PrismaRevenueStore(prismaClient));
    app.decorate("triggerStore", new PrismaTriggerStore(prismaClient));
  }

  const { resolveAuthoritativeDeployment } =
    await import("./bootstrap/platform-deployment-resolver.js");
  const { ROBIN_RECOVERY_SEND_INTENT } =
    await import("./services/workflows/robin-recovery-request.js");

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

  // Parked-approval Slack notifications (env-gated pilot posture; spec:
  // 2026-06-05-slack-approval-notifications-design.md section 5). Undefined
  // unless SLACK_BOT_TOKEN + SLACK_APPROVAL_CHANNEL are both set.
  const { buildParkedApprovalNotifier } = await import("./bootstrap/approval-notifier.js");
  const approvalNotifier = buildParkedApprovalNotifier(
    {
      slackBotToken: process.env.SLACK_BOT_TOKEN,
      slackApprovalChannel: process.env.SLACK_APPROVAL_CHANNEL,
    },
    app.log,
  );

  const platformIngress = new PlatformIngress({
    intentRegistry,
    modeRegistry,
    governanceGate: platformGovernanceGate,
    deploymentResolver: resolveAuthoritativeDeployment(deploymentResolver, {
      // Non-skill, platform-initiated intents resolve to a platform-direct context instead of a
      // strict skillSlug lookup that throws deployment_not_found for their intent prefix:
      //  - operator_mutation crons (Ledger/receipt/booking), system_auto_approved; and
      //  - Robin's no-show recovery campaign, which PARKS via a seeded mandatory require_approval
      //    policy (platform-direct supervised/0 cannot relax mandatory, so this is safe).
      isPlatformDirectIntent: (intent) =>
        intentRegistry.lookup(intent)?.defaultMode === "operator_mutation" ||
        intent === ROBIN_RECOVERY_SEND_INTENT,
    }),
    traceStore: workTraceStore,
    lifecycleService: lifecycleService ?? undefined,
    entitlementResolver: billingEntitlementResolver,
    auditLedger: ledger,
    operatorAlerter,
    approvalNotifier,
  });
  app.decorate("platformIngress", platformIngress);

  // Late-bind the delegation submitter now that PlatformIngress exists (see the
  // childWorkSubmitter declaration above). Reuses createSubmitChildWork so agent
  // delegation flows through the same governed front door as contained workflows.
  {
    const { createSubmitChildWork } = await import("./bootstrap/contained-workflows.js");
    submitChildWorkRef = createSubmitChildWork({ platformIngress, deploymentResolver });
  }

  // --- Contained workflow mode (creative pipeline, Meta lead intake) ---
  let instantFormAdapter: import("@switchboard/ad-optimizer").InstantFormAdapter | undefined;
  let submitScheduledFollowUp:
    | import("./services/cron/scheduled-follow-up-dispatch.js").SubmitScheduledFollowUp
    | undefined;
  let submitScheduledReminder:
    | ((
        input: import("./services/workflows/reminder-send-request.js").ReminderSendSubmitInput,
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse>)
    | undefined;
  let submitRecoveryCampaign:
    | ((
        input: import("./services/workflows/robin-recovery-request.js").RecoveryCampaignSubmitInput,
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse | null>)
    | undefined;
  let submitRecommendationHandoff:
    | ((
        input: import("./services/workflows/recommendation-handoff-request.js").RecommendationHandoffSubmitInput,
        deployment: { deploymentId: string; skillSlug: string },
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse | null>)
    | undefined;
  let submitRileyPause:
    | ((
        input: import("./services/workflows/riley-pause-submit-request.js").RileyPauseSubmitInput,
        deployment: { deploymentId: string; skillSlug: string },
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse | null>)
    | undefined;
  let submitRileyBudget:
    | ((
        input: import("./services/workflows/riley-budget-submit-request.js").RileyBudgetSubmitInput,
        deployment: { deploymentId: string; skillSlug: string },
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse | null>)
    | undefined;
  let submitMiraBriefCompose:
    | ((
        input: import("./services/workflows/mira-self-brief-request.js").MiraBriefComposeSubmitInput,
        deployment?: { deploymentId: string; skillSlug: string },
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse>)
    | undefined;
  let submitMiraConceptDraft:
    | ((
        input: import("./services/workflows/mira-self-brief-request.js").MiraConceptDraftSubmitInput,
        deployment?: { deploymentId: string; skillSlug: string },
      ) => Promise<import("@switchboard/core/platform").SubmitWorkResponse>)
    | undefined;
  if (prismaClient) {
    const { bootstrapContainedWorkflows } = await import("./bootstrap/contained-workflows.js");
    // workTraceStore is always constructed alongside prismaClient (above); the
    // pause executor's last-mile approved-lifecycle check (D5-2a) reads it, so a
    // missing store here is a wiring bug, not a degraded mode. Fail loud.
    if (!workTraceStore) {
      throw new Error(
        "workTraceStore must be initialized when prismaClient is present (riley pause last-mile gate)",
      );
    }
    const result = await bootstrapContainedWorkflows({
      prismaClient,
      intentRegistry,
      modeRegistry,
      platformIngress,
      deploymentResolver,
      workTraceStore,
      logger: app.log,
    });
    instantFormAdapter = result.instantFormAdapter;
    submitScheduledFollowUp = result.submitScheduledFollowUp;
    submitScheduledReminder = result.submitScheduledReminder;
    submitRecoveryCampaign = result.submitRecoveryCampaign;
    submitRecommendationHandoff = result.submitRecommendationHandoff;
    submitRileyPause = result.submitRileyPause;
    submitRileyBudget = result.submitRileyBudget;
    submitMiraBriefCompose = result.submitMiraBriefCompose;
    submitMiraConceptDraft = result.submitMiraConceptDraft;
  }

  // --- Phase 3b: lifecycle disqualification hook + store decoration (Wave 2 Phase 1b.3) ---
  // Bootstraps the lifecycle IoC tree once and captures snapshotStore, transitionStore, and
  // disqualificationHook. The hook is decorated on app here so bootstrapOperatorIntents
  // (below) can register operator.confirm_disqualification / operator.dismiss_disqualification
  // intent handlers. The stores are carried forward to registerRoutes for the GET route.
  let _lsSnapshotStore: import("@switchboard/core").LifecycleSnapshotStore | undefined = undefined;
  let _lsTransitionStore: import("@switchboard/core").LifecycleTransitionStore | undefined =
    undefined;
  if (prismaClient) {
    try {
      const { bootstrapLifecycle } = await import("./bootstrap/lifecycle.js");
      const { createLifecycleGovernanceConfigResolver } =
        await import("./bootstrap/governance-resolver-adapter.js");
      const {
        snapshotStore: lsSnapshotStore,
        transitionStore: lsTransitionStore,
        disqualificationHook: lsDisqualificationHook,
      } = bootstrapLifecycle({
        prisma: prismaClient,
        readMode: async () => "off" as const,
        registerVerdictWriteHook: () => {},
        registerBookingCreateHook: () => {},
        registerInboundMessageHook: () => {},
        registerOperatorTakeoverHook: () => {},
        registerThreadInitHook: () => {},
        registerCron: () => {},
        playbookReader: { readForOrganization: async () => null },
        governanceConfigResolver: createLifecycleGovernanceConfigResolver(prismaClient),
      });
      app.decorate("disqualificationHook", lsDisqualificationHook);
      _lsSnapshotStore = lsSnapshotStore;
      _lsTransitionStore = lsTransitionStore;
    } catch (err) {
      app.log.error(
        `Failed to bootstrap lifecycle disqualification hook: ${err instanceof Error ? err.message : String(err)}`,
      );
      app.decorate("disqualificationHook", null);
    }
  }

  // --- Operator-direct ingress mode (Wave 2 Phase 1b) ---
  // Gate on prismaClient (the actual underlying condition) rather than app.opportunityStore,
  // which is only set when prismaClient is available anyway. bootstrapOperatorIntents
  // conditionally registers each store's handler+intent internally so passing
  // potentially-undefined stores is safe.
  if (prismaClient) {
    const { bootstrapOperatorIntents } = await import("./bootstrap/operator-intents.js");
    const { PrismaOutboxStore } = await import("@switchboard/db");
    const { PrismaReceiptStore } = await import("@switchboard/db");
    const { PrismaBookingStore } = await import("@switchboard/db");
    const { PrismaReceiptedBookingStore } = await import("@switchboard/db");
    const prismaOutbox = new PrismaOutboxStore(prismaClient);
    const prismaReceipts = new PrismaReceiptStore(prismaClient);
    // Fresh instance: the `reportStores.bookings` above is scoped to a different
    // `if (prismaClient)` block and is not in scope here.
    const bookingAttendanceStore = new PrismaBookingStore(prismaClient);
    // The governed write-side store for receipt.reconcile_booking (override / flag / resolve).
    const reconcileBookingStore = new PrismaReceiptedBookingStore(prismaClient);

    // operator.erase_contact eraser: wraps the SAME full delete cascade as the Meta data-deletion
    // callback (eraseContactFully) behind the operator-direct intent, plus an org-scoped existence
    // gate (fail-closed cross-tenant) and a durable DataDeletionRequest audit row.
    const { PrismaContactStore: PrismaContactStoreForErasure } = await import("@switchboard/db");
    const { eraseContactFully } = await import("./lib/erase-contact.js");
    const { createCalendarProviderFactory: createErasureCalendarFactory } =
      await import("./bootstrap/calendar-provider-factory.js");
    const erasureContactStore = new PrismaContactStoreForErasure(prismaClient);
    const erasureCalendarFactory = createErasureCalendarFactory({
      prismaClient,
      logger: { info: (m: string) => app.log.info(m), error: (m: string) => app.log.error(m) },
    });
    const contactEraser: import("./bootstrap/operator-intents.js").OperatorContactEraser = {
      findContactForOrg: async (orgId: string, contactId: string) => {
        const row = await prismaClient.contact.findFirst({
          where: { id: contactId, organizationId: orgId },
          select: { id: true },
        });
        return row !== null;
      },
      erase: (orgId: string, contactId: string) =>
        eraseContactFully(
          {
            prisma: prismaClient,
            contactStore: erasureContactStore,
            calendarProviderFactory: erasureCalendarFactory,
            logger: app.log,
          },
          orgId,
          contactId,
        ),
      recordRequest: async ({ orgId, contactId, actorId, status, failureReason }) => {
        await prismaClient.dataDeletionRequest.create({
          data: {
            userId: `operator:${actorId}`,
            confirmationCode: crypto.randomUUID(),
            requestType: "operator_erasure",
            organizationId: orgId,
            requestedByActorId: actorId,
            deletedContactIds: status === "completed" ? [contactId] : [],
            status,
            failureReason: failureReason ?? null,
            completedAt: status === "completed" ? new Date() : null,
          },
        });
      },
    };

    // Ledger-lite slice 2: the weekly owner-report delivery writer. Constructed only
    // when the report projection stores are present (they are decorated in the same
    // prismaClient gate above). When undefined, the ledger.deliver_weekly_report intent
    // is not registered (mirrors the conditional-decoration pattern; the cron stays dark).
    let weeklyReportDeliveryWriter:
      | import("./bootstrap/operator-intents.js").WeeklyReportDeliveryWriter
      | undefined;
    if (app.reportStores && app.reportCacheStore) {
      const reportStoresForDelivery = app.reportStores;
      const reportCacheForDelivery = app.reportCacheStore;
      const { createWeeklyReportDeliveryService } =
        await import("./services/reports/weekly-report-delivery.js");
      const { assembleWeeklyReport } = await import("./services/reports/assemble-weekly-report.js");
      const { resolveOwnerReportRecipients } =
        await import("./services/reports/weekly-report-recipients.js");
      const { createResendEmailSender } = await import("./services/notifications/send-email.js");
      const { getEscalationConfig } = await import("./services/escalation-config-service.js");
      const { createInMemoryBaselineStore } = await import("@switchboard/core/reports");
      const baselineForDelivery = app.baselineStore ?? createInMemoryBaselineStore();

      weeklyReportDeliveryWriter = createWeeklyReportDeliveryService({
        resolveRecipients: (orgId: string) =>
          resolveOwnerReportRecipients(
            {
              getConfig: (id: string) => getEscalationConfig(prismaClient, id),
              listVerifiedUserEmails: async (id: string) =>
                (
                  await prismaClient.dashboardUser.findMany({
                    where: { organizationId: id, emailVerified: { not: null } },
                    select: { email: true },
                  })
                ).map((u) => u.email),
            },
            orgId,
          ),
        assembleReport: (orgId: string, now: Date) =>
          assembleWeeklyReport(
            {
              stores: reportStoresForDelivery,
              reportCache: reportCacheForDelivery,
              baselineStore: baselineForDelivery,
            },
            orgId,
            now,
          ),
        sendEmail: createResendEmailSender({
          apiKey: process.env["RESEND_API_KEY"],
          from: process.env["EMAIL_FROM"] ?? "noreply@switchboard.app",
        }),
        dashboardUrl: process.env["DASHBOARD_URL"] ?? "",
      });
    }

    bootstrapOperatorIntents({
      intentRegistry,
      modeRegistry,
      opportunityStore: app.opportunityStore,
      recommendationStore: app.recommendationStore,
      disqualificationHook: app.disqualificationHook ?? undefined,
      consentService: skillModeConsentService ?? undefined,
      revenueStore: app.revenueEventStore,
      outboxWriter: {
        write: (eventId, type, payload, tx) =>
          prismaOutbox.write(eventId, type, payload, tx as never).then(() => {}),
      },
      runInTransaction: (fn) => prismaClient.$transaction((tx) => fn(tx)),
      receiptWriter: {
        write: (input, tx) => prismaReceipts.mint(input, tx as never).then(() => {}),
      },
      // F3: anchor `verified` to a server-side PSP fetch-back via the per-org
      // payment port. Without it, payment.record_verified is not registered.
      paymentVerifier: app.paymentPortFactory
        ? (orgId: string, externalReference: string) =>
            app.paymentPortFactory!(orgId).then((port) => port.retrievePayment(externalReference))
        : undefined,
      bookingAttendanceWriter: bookingAttendanceStore,
      // Same store: an "attended" outcome promotes the booking's calendar receipt booked -> held.
      receiptHeldPromoter: prismaReceipts,
      reconcileBookingWriter: reconcileBookingStore,
      weeklyReportDeliveryWriter,
      contactEraser,
      logger: app.log,
    });
  }

  const { PlatformLifecycle } = await import("@switchboard/core/platform");
  const platformLifecycle = new PlatformLifecycle({
    approvalStore: storage.approvals,
    envelopeStore: storage.envelopes,
    identityStore: storage.identity,
    modeRegistry,
    traceStore: workTraceStore ?? {
      persist: async () => {},
      claim: async () => ({ claimed: true as const }),
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
  // Dev/test identity resolution must run BEFORE the idempotency middleware so the
  // request fingerprint sees the resolved org/actor at check-time AND store-time
  // (#575). In production this is a no-op (authMiddleware already populated the auth
  // fields and authDisabled === false); in dev/test it mirrors that ordering instead
  // of leaving org resolution to route-scoped preHandlers that run after the global
  // idempotency check. applyDefault:false → resolve only request-supplied identity
  // (like prod auth, which never defaults to "default"); the per-route hooks still
  // apply the "default" affordance afterwards, so routes that treat an absent org as
  // unscoped (e.g. /api/policies) are not silently scoped to "default".
  app.addHook("preHandler", buildDevAuthFallback(app, { applyDefault: false }));
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
  await registerInngest(app, {
    instantFormAdapter,
    operatorAlerter,
    submitScheduledFollowUp,
    submitScheduledReminder,
    submitRecoveryCampaign,
    submitRecommendationHandoff,
    submitRileyPause,
    submitRileyBudget,
    submitMiraBriefCompose,
    submitMiraConceptDraft,
  });

  // --- Phase 3b: lifecycle disqualification route deps ---
  // The lifecycle hook was already bootstrapped and decorated on app earlier
  // (before bootstrapOperatorIntents). Here we only need to wire the stores for
  // the GET route; the POST routes now read app.disqualificationHook directly.
  let lifecycleDisqualificationsDeps:
    | import("./routes/lifecycle-disqualifications.js").LifecycleDisqualificationsRouteDeps
    | undefined;
  if (_lsSnapshotStore && _lsTransitionStore) {
    lifecycleDisqualificationsDeps = {
      snapshotStore: _lsSnapshotStore,
      transitionStore: _lsTransitionStore,
    };
  }

  // --- Register all API routes ---
  // ConsentService is wired into bootstrapOperatorIntents above (Phase 1b.4
  // migration). It is also passed here as a gate-only reference so the admin
  // consent route is only registered when its operator-intent handlers exist
  // (Phase 1b.4 review-followup #4 — gate symmetry).
  await registerRoutes(app, {
    consentReader: skillModeContactConsentReader ?? undefined,
    consentService: skillModeConsentService ?? undefined,
    lifecycleDisqualifications: lifecycleDisqualificationsDeps,
  });

  return app;
}
