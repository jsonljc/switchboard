import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { ReplySink } from "@switchboard/core";
import { ChannelGateway } from "@switchboard/core";
import { checkIngressRateLimit } from "./adapters/security.js";
import { RuntimeRegistry } from "./managed/runtime-registry.js";
import { startHealthChecker } from "./managed/health-checker.js";
import { runStartupChecks } from "./startup-checks.js";
import { initDedup, checkDedup } from "./dedup/redis-dedup.js";
import { SseSessionManager } from "./endpoints/widget-sse-manager.js";
import { registerWidgetMessagesEndpoint } from "./endpoints/widget-messages.js";
import { registerWidgetEventsEndpoint } from "./endpoints/widget-events.js";
import { registerWidgetEmbedEndpoint } from "./endpoints/widget-embed.js";
import { createGatewayBridge } from "./gateway/gateway-bridge.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { HttpPlatformIngressAdapter } from "./gateway/http-platform-ingress-adapter.js";
import { StaticDeploymentResolver } from "./single-tenant/static-deployment-resolver.js";
import { InMemoryGatewayConversationStore } from "./single-tenant/memory-conversation-store.js";
import { FailedMessageStore } from "./dlq/failed-message-store.js";
import { registerManagedWebhookRoutes } from "./routes/managed-webhook.js";
import { CtwaAdapter } from "@switchboard/ad-optimizer";

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
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        (req as unknown as Record<string, unknown>).rawBody = body;
        const params = new URLSearchParams(body as string);
        const payload = params.get("payload");
        done(null, payload ? JSON.parse(payload) : Object.fromEntries(params));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Platform ingress adapter — all chat traffic routes through the API server
  const apiUrl = process.env["SWITCHBOARD_API_URL"] ?? "http://localhost:3000";
  const apiKey = process.env["SWITCHBOARD_API_KEY"];
  const platformIngressAdapter = new HttpPlatformIngressAdapter(apiUrl, apiKey);

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
  if (process.env["DATABASE_URL"]) {
    const { getDb } = await import("@switchboard/db");
    const prisma = getDb();
    healthPrisma = prisma;
    failedMessageStore = new FailedMessageStore(prisma);
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

  // CTWA lead intake adapter — singleton. Inbound WhatsApp messages tagged with
  // `ctwa_clid` are forwarded through PlatformIngress.submit(intent="lead.intake")
  // so a Contact gets created with sourceType="ctwa". The shim below adapts the
  // adapter's narrow `IngressLike` contract to the chat app's HTTP ingress
  // adapter, supplying the synthetic actor + chat surface metadata required by
  // the canonical request envelope. Same pattern as
  // apps/api/src/bootstrap/contained-workflows.ts:66-91.
  const ctwaAdapter = new CtwaAdapter({
    ingress: {
      submit: async (req) => {
        const payload = req.payload as {
          organizationId: string;
          deploymentId: string;
        };
        const response = await platformIngressAdapter.submit({
          organizationId: payload.organizationId,
          actor: { id: "system:whatsapp-ctwa-inbound", type: "system" },
          intent: req.intent,
          parameters: req.payload as Record<string, unknown>,
          trigger: "internal",
          surface: { surface: "chat" },
          idempotencyKey: req.idempotencyKey,
          targetHint: { deploymentId: payload.deploymentId },
          ...(req.parentWorkUnitId ? { parentWorkUnitId: req.parentWorkUnitId } : {}),
        });
        if (!response.ok) {
          return { ok: false };
        }
        return { ok: true, result: response.result };
      },
    },
    now: () => new Date(),
  });

  // --- Managed runtime registry (multi-tenant) + widget endpoints ---
  let registry: RuntimeRegistry | null = null;
  let stopHealthChecker: (() => void) | null = null;
  let sseManager: SseSessionManager | null = null;
  let managedGateway: import("@switchboard/core").ChannelGateway | null = null;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb } = await import("@switchboard/db");
      const prisma = getDb();

      managedGateway = createGatewayBridge(prisma, {
        platformIngress: platformIngressAdapter,
      });

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
        { channel: "telegram", token: "single-tenant", sessionId: threadId, text: incoming.text },
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
  if (registry) {
    registerManagedWebhookRoutes(app, {
      registry,
      failedMessageStore,
      ctwaAdapter,
      dedup: { checkDedup },
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
