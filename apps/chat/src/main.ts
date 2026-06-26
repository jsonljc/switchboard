import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { timingSafeEqual } from "node:crypto";
import type { ReplySink } from "@switchboard/core";
import { ChannelGateway, setMetrics, PrismaDeploymentResolver } from "@switchboard/core";
import { checkIngressRateLimit } from "./adapters/security.js";
import { createPromMetrics, metricsRoute } from "./bootstrap/metrics.js";
import { RuntimeRegistry } from "./managed/runtime-registry.js";
import { startHealthChecker } from "./managed/health-checker.js";
import { runStartupChecks } from "./startup-checks.js";
import { initDedup, checkDedup } from "./dedup/redis-dedup.js";
import { SseSessionManager } from "./endpoints/widget-sse-manager.js";
import { registerWidgetMessagesEndpoint } from "./endpoints/widget-messages.js";
import { registerWidgetEventsEndpoint } from "./endpoints/widget-events.js";
import { registerWidgetEmbedEndpoint } from "./endpoints/widget-embed.js";
import { createGatewayBridge } from "./gateway/gateway-bridge.js";
import { registerSlackFormEncodedParser } from "./routes/slack-form-parser.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { HttpPlatformIngressAdapter } from "./gateway/http-platform-ingress-adapter.js";
import { buildCtwaIngressSubmitRequest } from "./gateway/ctwa-ingress-request.js";
import { buildCtwaCampaignResolver } from "./gateway/ctwa-campaign-resolver.js";
import { StaticDeploymentResolver } from "./single-tenant/static-deployment-resolver.js";
import { InMemoryGatewayConversationStore } from "./single-tenant/memory-conversation-store.js";
import { FailedMessageStore } from "./dlq/failed-message-store.js";
import { registerManagedWebhookRoutes } from "./routes/managed-webhook.js";
import { chatHealthRoutes } from "./routes/health.js";
import { buildWhatsAppStatusBridge } from "./bridges/whatsapp-test-send-status-bridge.js";
import { makeWhatsAppStatusHandler } from "./bridges/whatsapp-status-persistence.js";
import { CtwaAdapter, MetaAdsClient } from "@switchboard/ad-optimizer";

async function main() {
  // Initialize Sentry before anything else
  const { initChatSentry, captureException } = await import("./bootstrap/sentry.js");
  await initChatSentry();

  // Pre-boot validation — fail fast with clear error messages
  const checks = runStartupChecks();
  for (const warning of checks.warnings) {
    console.warn(`[Startup] WARNING: ${warning}`);
  }
  if (!checks.ok) {
    for (const error of checks.errors) {
      console.error(`[Startup] ERROR: ${error}`);
    }
    console.error("[Startup] Aborting — fix the above errors before starting");
    process.exit(1);
  }

  // Initialize Prometheus metrics for this process. Without this, getMetrics()
  // returns the in-memory default and the new outcome-pattern Prom series
  // silently no-op in production. Mirrors apps/api/src/app.ts.
  setMetrics(createPromMetrics());

  const chatLogLevel =
    process.env["LOG_LEVEL"] ?? (process.env.NODE_ENV === "production" ? "info" : "debug");
  const app = Fastify({
    logger: {
      level: chatLogLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "body.token",
          "body.accessToken",
        ],
        censor: "[REDACTED]",
      },
      ...(process.env.NODE_ENV === "production" ? {} : { transport: { target: "pino-pretty" } }),
    },
  });

  // Parse application/x-www-form-urlencoded (Slack interactive payloads)
  registerSlackFormEncodedParser(app);

  // Capture the raw request body for routes that opt in via { config: { rawBody: true } }.
  // The managed webhook verifies HMAC signatures over the EXACT bytes the platform signed;
  // re-serializing request.body silently drops valid inbound messages (security audit F9).
  // global:false so only opted-in routes pay the buffering cost. Mirrors apps/api/src/app.ts.
  // Registered before the managed routes below so fastify-raw-body's onRoute hook sees them.
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  // Platform ingress adapter — all chat traffic routes through the API server. The hop
  // authenticates as a trusted internal service with INTERNAL_API_SECRET (F-15): the chat
  // service resolves each inbound's org server-side and carries it in the request body, and
  // the API honors it on the internal-secret-authed ingress route. The boot guard above
  // refuses to start in managed mode (DATABASE_URL set) without this secret.
  const apiUrl = process.env["SWITCHBOARD_API_URL"] ?? "http://localhost:3000";
  const internalSecret = process.env["INTERNAL_API_SECRET"];
  const platformIngressAdapter = new HttpPlatformIngressAdapter(apiUrl, internalSecret);

  // Single-tenant setup: ChannelGateway with static deployment.
  // This path serves the /webhook/telegram endpoint for dev and non-DB deployments.
  // When DATABASE_URL is set, managed channels (registered via ManagedChannel rows)
  // are handled separately through RuntimeRegistry + /webhook/managed/:id routes.
  // This path remains necessary because:
  //   1. Dev environments run without a database
  //   2. The /webhook/telegram endpoint is only wired through this gateway
  //   3. Managed channels use a different webhook path scheme (/webhook/managed/<uuid>)
  const botToken = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
  const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"];
  const singleTenantAdapter = new TelegramAdapter(botToken, undefined, webhookSecret);
  const singleTenantGateway = new ChannelGateway({
    deploymentResolver: new StaticDeploymentResolver({}),
    platformIngress: platformIngressAdapter,
    conversationStore: new InMemoryGatewayConversationStore(),
    // Single-tenant path is used in dev/no-DB environments where no real approvals
    // exist. If an approval-shaped payload arrives, the gateway intercepts it and
    // getById returns null → the caller receives a NOT_FOUND_MSG and the message is
    // dropped before reaching PlatformIngress.submit() or the LLM.
    // approvalResponseConfig stays DELIBERATELY unwired here: without a database
    // there are no orgs, no OperatorChannelBindings, and no real approvals, and
    // this path's only channel is Telegram, whose outbound approve buttons are
    // undeliverable anyway (callback_data 64-byte cap). See the chat-approval
    // bridge spec (2026-06-05), section 5.
    approvalStore: {
      save: async () => {},
      getById: async () => null,
      updateState: async () => {},
      listPending: async () => [],
    },
  });

  // Shared connections for health checks — avoid creating new ones on each call
  let healthPrisma: import("@switchboard/db").PrismaClient | null = null;
  let healthRedis: import("ioredis").default | null = null;

  // DLQ store
  let failedMessageStore: FailedMessageStore | null = null;
  let testSendStore: import("@switchboard/db").PrismaWhatsAppTestSendStore | null = null;
  let whatsappStatusStore: import("@switchboard/db").PrismaWhatsAppStatusStore | null = null;
  if (process.env["DATABASE_URL"]) {
    const { getDb, PrismaWhatsAppTestSendStore, PrismaWhatsAppStatusStore } =
      await import("@switchboard/db");
    const prisma = getDb();
    healthPrisma = prisma;
    failedMessageStore = new FailedMessageStore(prisma);
    testSendStore = new PrismaWhatsAppTestSendStore(prisma);
    whatsappStatusStore = new PrismaWhatsAppStatusStore(prisma);
  }

  // Initialize Redis-backed security store if Redis is available
  if (process.env["REDIS_URL"]) {
    try {
      const Redis = (await import("ioredis")).default;
      const { RedisSecurityStore } = await import("./adapters/redis-security-store.js");
      const { initSecurityStore } = await import("./adapters/security.js");
      const redisClient = new Redis(process.env["REDIS_URL"]);
      healthRedis = redisClient;
      initSecurityStore(new RedisSecurityStore(redisClient as never));
      initDedup(redisClient as never);
      app.log.info("Redis security store + dedup initialized");
    } catch (err) {
      console.warn("Failed to initialize Redis security store, using in-memory fallback:", err);
    }
  }

  // Rate limit config for webhook ingress
  const rateLimitConfig = {
    windowMs: parseInt(process.env["WEBHOOK_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
    maxRequests: parseInt(process.env["WEBHOOK_RATE_LIMIT_MAX"] ?? "120", 10),
  };

  // Global error handler — consistent error format, no stack leaks
  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    if (statusCode >= 500) {
      captureException(error, { url: _request.url, method: _request.method });
    }
    app.log.error(error);
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // CTWA campaign-id resolver — org-scoped. The adapter writes `sourceCampaignId`
  // onto the lead.intake attribution so the creative -> booked-booking join (the
  // headline receipted-bookings-per-creative metric) is populated. Without this
  // dep the metric is structurally zero for every CTWA lead. Resolution needs the
  // org's Meta credentials (DB + decrypt + MetaAdsClient), which ad-optimizer
  // (Layer 2) cannot do, so it is injected here. Only available when DATABASE_URL
  // is set (managed channels); the dev/no-DB path leaves it unwired and the
  // adapter submits without sourceCampaignId. Credentials are scoped to the lead's
  // org via the canonical Meta Ads connection lookup (serviceId "meta-ads",
  // status "connected"), matching apps/api dashboard-reports resolution.
  let resolveCtwaCampaignId:
    | ((adId: string, ctx: { organizationId: string }) => Promise<string | null>)
    | undefined;
  if (healthPrisma) {
    const prisma = healthPrisma;
    const { decryptCredentials } = await import("@switchboard/db");
    resolveCtwaCampaignId = buildCtwaCampaignResolver({
      lookupConnection: (organizationId) =>
        prisma.connection.findFirst({
          where: { organizationId, serviceId: "meta-ads", status: "connected" },
          select: { credentials: true, externalAccountId: true },
        }),
      // The `credentials` column is typed JsonValue but always stores the base64
      // string produced by encryptCredentials, so forward it as-is.
      decryptCredentials: (credentials) => decryptCredentials(credentials as string),
      createAdsClient: (config) => new MetaAdsClient(config),
    });
  }

  // CTWA lead intake adapter — singleton. Inbound WhatsApp messages tagged with
  // `ctwa_clid` are forwarded through PlatformIngress.submit(intent="lead.intake")
  // so a Contact gets created with sourceType="ctwa". The shim below adapts the
  // adapter's narrow `IngressLike` contract to the chat app's HTTP ingress
  // adapter, supplying the synthetic actor + chat surface metadata required by
  // the canonical request envelope. Same pattern as the Instant-Form shim in
  // apps/api/src/bootstrap/contained-workflows.ts.
  const ctwaAdapter = new CtwaAdapter({
    ingress: {
      submit: async (req) => {
        // Seeded `system` principal (not a bespoke system:* id) so governance can
        // resolve the actor's IdentitySpec — see gateway/ctwa-ingress-request.ts.
        const response = await platformIngressAdapter.submit(buildCtwaIngressSubmitRequest(req));
        if (!response.ok) {
          // P2-4: thread the IngressError type/message through (instead of
          // stripping it to a bare `{ok:false}`) so the adapter and the route's
          // fire-and-forget `.catch` can surface WHY a paid CTWA lead was dropped.
          return {
            ok: false,
            error: { type: response.error.type, message: response.error.message },
          };
        }
        return { ok: true, result: response.result };
      },
    },
    now: () => new Date(),
    ...(resolveCtwaCampaignId ? { resolveCampaignId: resolveCtwaCampaignId } : {}),
  });

  // --- Managed runtime registry (multi-tenant) + widget endpoints ---
  let registry: RuntimeRegistry | null = null;
  let stopHealthChecker: (() => void) | null = null;
  let sseManager: SseSessionManager | null = null;
  let managedGateway: import("@switchboard/core").ChannelGateway | null = null;
  // Resolves the org's Alex AgentDeployment for CTWA lead attribution (see the
  // managed webhook route). Only available when DATABASE_URL is set; the route
  // falls back to the channel-connection id when unwired so a lead is never lost.
  let ctwaDeploymentResolver: PrismaDeploymentResolver | null = null;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb } = await import("@switchboard/db");
      const prisma = getDb();

      managedGateway = createGatewayBridge(prisma, {
        platformIngress: platformIngressAdapter,
      });
      ctwaDeploymentResolver = new PrismaDeploymentResolver(prisma as never);

      registry = new RuntimeRegistry();
      await registry.loadAll(prisma, managedGateway);
      await registry.loadGatewayConnections(prisma, managedGateway);
      app.log.info(`Loaded ${registry.size} managed runtimes from database`);
      stopHealthChecker = startHealthChecker(prisma);

      // Widget endpoints
      sseManager = new SseSessionManager();
      registerWidgetMessagesEndpoint(app, managedGateway, sseManager);
      registerWidgetEventsEndpoint(app, sseManager);
      registerWidgetEmbedEndpoint(app);
      app.log.info("Widget endpoints registered");
    } catch (err) {
      app.log.error(err, "Failed to initialize RuntimeRegistry and widget endpoints");
    }
  }

  // Deep readiness — distinct from the shallow /health below; used by external uptime
  // probes and Render's readiness gating per docs/superpowers/specs/2026-05-15-deployment-hosting-design.md
  await app.register(chatHealthRoutes, {
    prefix: "/api/health",
    prisma: healthPrisma ?? null,
    redis: healthRedis ?? null,
    apiBaseUrl: process.env["SWITCHBOARD_API_URL"] ?? null,
    internalApiSecret: process.env["INTERNAL_API_SECRET"] ?? null,
  });

  // Health check — reuses existing connections (no leak per call)
  const chatBootTime = Date.now();
  app.get("/health", async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    const timeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
      ]);

    if (healthPrisma) {
      try {
        await timeout(healthPrisma.$queryRaw`SELECT 1`, 3000);
        checks["db"] = "ok";
      } catch {
        checks["db"] = "unreachable";
        healthy = false;
      }
    }

    if (healthRedis) {
      try {
        await timeout(healthRedis.ping(), 3000);
        checks["redis"] = "ok";
      } catch {
        checks["redis"] = "unreachable";
        healthy = false;
      }
    }

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      checks,
      uptime: Math.floor((Date.now() - chatBootTime) / 1000),
      managedChannels: registry?.size ?? 0,
    });
  });

  // Prometheus metrics scrape endpoint
  app.get("/metrics", metricsRoute);

  // Telegram webhook endpoint (single-tenant) — uses ChannelGateway + PlatformIngress
  app.post("/webhook/telegram", async (request, reply) => {
    if (singleTenantAdapter.verifyRequest) {
      const rawBody = JSON.stringify(request.body);
      const headers = request.headers as Record<string, string | undefined>;
      if (!singleTenantAdapter.verifyRequest(rawBody, headers)) {
        app.log.warn("Webhook request failed signature verification");
        return reply.code(401).send({ error: "Invalid signature" });
      }
    }

    const sourceIp = request.ip;
    if (!(await checkIngressRateLimit(sourceIp, rateLimitConfig))) {
      app.log.warn({ ip: sourceIp }, "Webhook rate limit exceeded");
      return reply.code(200).send({ ok: true });
    }

    const payload = request.body as Record<string, unknown>;
    const msg = payload["message"] as Record<string, unknown> | undefined;
    const cb = payload["callback_query"] as Record<string, unknown> | undefined;
    const nonceId = msg ? String(msg["message_id"]) : cb ? String(cb["id"]) : null;
    if (nonceId) {
      const isNew = await checkDedup("telegram", nonceId);
      if (!isNew) {
        app.log.warn({ nonceId }, "Duplicate webhook message, skipping");
        return reply.code(200).send({ ok: true });
      }
    }

    try {
      const incoming = singleTenantAdapter.parseIncomingMessage(request.body);
      if (!incoming) {
        return reply.code(200).send({ ok: true });
      }

      const threadId = incoming.threadId ?? incoming.principalId;
      const replySink: ReplySink = {
        send: async (text) => singleTenantAdapter.sendTextReply(threadId, text),
      };

      await singleTenantGateway.handleIncoming(
        {
          channel: "telegram",
          token: "single-tenant",
          sessionId: threadId,
          principalId: incoming.principalId,
          text: incoming.text,
        },
        replySink,
      );
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error(err, "Error handling webhook");
      failedMessageStore
        ?.record({
          channel: "telegram",
          rawPayload: request.body as Record<string, unknown>,
          stage: "unknown",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        })
        .catch((dlqErr) => app.log.error(dlqErr, "DLQ record error"));
      return reply.code(200).send({ ok: true });
    }
  });

  // --- Managed channel webhook routes (GET verification + POST messages) ---
  const statusBridge = testSendStore ? buildWhatsAppStatusBridge({ testSendStore }) : null;
  // Persist real-conversation delivery/read/failed receipts to the general
  // status store (audit #6: only the test-send bridge consumed status before, so
  // production receipts were dropped). The test-send bridge stays wired as the
  // downstream handler, preserving its orgId guard.
  const onStatusUpdate =
    whatsappStatusStore || statusBridge
      ? makeWhatsAppStatusHandler({
          statusStore: whatsappStatusStore,
          next: statusBridge
            ? async (update, orgId) => {
                if (!orgId) {
                  app.log.warn(
                    { messageId: update.messageId },
                    "WhatsApp status webhook arrived without orgId; skipping test-send bridge",
                  );
                  return;
                }
                await statusBridge.onStatusUpdate(update, orgId);
              }
            : undefined,
        })
      : undefined;
  if (registry) {
    registerManagedWebhookRoutes(app, {
      registry,
      failedMessageStore,
      ctwaAdapter,
      dedup: { checkDedup },
      ...(ctwaDeploymentResolver ? { deploymentResolver: ctwaDeploymentResolver } : {}),
      ...(onStatusUpdate ? { onStatusUpdate } : {}),
    });
  }

  // --- Internal provision-notify endpoint ---
  app.post("/internal/provision-notify", async (request, reply) => {
    // Verify shared secret — fail-closed: reject if INTERNAL_API_SECRET is not set
    const internalSecret = process.env["INTERNAL_API_SECRET"];
    if (!internalSecret) {
      app.log.error("INTERNAL_API_SECRET is not configured — rejecting internal request");
      return reply.code(503).send({ error: "Internal authentication not configured" });
    }
    const authHeader = request.headers["authorization"];
    const expectedAuth = `Bearer ${internalSecret}`;
    if (
      !authHeader ||
      authHeader.length !== expectedAuth.length ||
      !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedAuth))
    ) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (!registry) {
      return reply.code(503).send({ error: "Registry not initialized" });
    }

    const { managedChannelId } = request.body as { managedChannelId: string };
    if (!managedChannelId) {
      return reply.code(400).send({ error: "managedChannelId is required" });
    }

    try {
      const { getDb } = await import("@switchboard/db");
      const prisma = getDb();
      const channel = await prisma.managedChannel.findUnique({
        where: { id: managedChannelId },
      });

      if (!channel) {
        return reply.code(404).send({ error: "ManagedChannel not found" });
      }

      if (!managedGateway) {
        return reply.code(503).send({ error: "Gateway not initialized" });
      }
      await registry.provision(channel, prisma, managedGateway);
      app.log.info({ managedChannelId, channel: channel.channel }, "Provisioned managed runtime");
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error(err, "Failed to provision managed runtime");
      return reply.code(500).send({ error: "Provisioning failed" });
    }
  });

  const port = parseInt(process.env["CHAT_PORT"] ?? "3001", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  // Graceful shutdown — drain connections on SIGTERM/SIGINT
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
    if (stopHealthChecker) stopHealthChecker();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    captureException(reason, { type: "unhandledRejection" });
    app.log.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    captureException(err, { type: "uncaughtException" });
    app.log.error({ err }, "Uncaught exception — shutting down");
    shutdown("uncaughtException");
  });

  try {
    await app.listen({ port, host });
    app.log.info(`Switchboard Chat webhook server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
