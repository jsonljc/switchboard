import Fastify from "fastify";
import { createChatRuntime } from "./runtime.js";
import { checkIngressRateLimit, checkNonce } from "./adapters/security.js";
import { RuntimeRegistry } from "./managed/runtime-registry.js";
import { startHealthChecker } from "./managed/health-checker.js";

async function main() {
  const app = Fastify({ logger: true });

  const { runtime, cleanup } = await createChatRuntime();

  // Rate limit config for webhook ingress
  const rateLimitConfig = {
    windowMs: parseInt(process.env["WEBHOOK_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
    maxRequests: parseInt(process.env["WEBHOOK_RATE_LIMIT_MAX"] ?? "120", 10),
  };

  // Global error handler — consistent error format, no stack leaks
  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    app.log.error(error);
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  // --- Managed runtime registry (multi-tenant) ---
  let registry: RuntimeRegistry | null = null;
  let stopHealthChecker: (() => void) | null = null;

  if (process.env["DATABASE_URL"]) {
    try {
      const { getDb } = await import("@switchboard/db");
      const prisma = getDb();
      registry = new RuntimeRegistry();
      await registry.loadAll(prisma);
      app.log.info(`Loaded ${registry.size} managed runtimes from database`);
      stopHealthChecker = startHealthChecker(prisma);
    } catch (err) {
      app.log.error(err, "Failed to initialize RuntimeRegistry");
    }
  }

  // Health check — report degraded if DB is configured but unreachable
  app.get("/health", async () => {
    let dbStatus = "not_configured";
    if (process.env["DATABASE_URL"]) {
      try {
        const { getDb } = await import("@switchboard/db");
        await getDb().$queryRaw`SELECT 1`;
        dbStatus = "connected";
      } catch {
        dbStatus = "disconnected";
      }
    }
    return {
      status: dbStatus === "disconnected" ? "degraded" : "ok",
      database: dbStatus,
      managedChannels: registry?.size ?? 0,
      timestamp: new Date().toISOString(),
    };
  });

  // Telegram webhook endpoint (single-tenant, backward-compatible)
  app.post("/webhook/telegram", async (request, reply) => {
    // Verify request via adapter's verifyRequest() (timing-safe comparison)
    const adapter = runtime.getAdapter();
    if (adapter.verifyRequest) {
      const rawBody = JSON.stringify(request.body);
      const headers = request.headers as Record<string, string | undefined>;
      if (!adapter.verifyRequest(rawBody, headers)) {
        app.log.warn("Webhook request failed signature verification");
        return reply.code(200).send({ ok: true }); // 200 to avoid Telegram retries
      }
    }

    // Rate limit by source IP
    const sourceIp = request.ip;
    if (!checkIngressRateLimit(sourceIp, rateLimitConfig)) {
      app.log.warn({ ip: sourceIp }, "Webhook rate limit exceeded");
      return reply.code(200).send({ ok: true }); // 200 to avoid Telegram retries
    }

    // Nonce dedup — prevent duplicate processing on Telegram webhook retries
    const payload = request.body as Record<string, unknown>;
    const msg = payload["message"] as Record<string, unknown> | undefined;
    const cb = payload["callback_query"] as Record<string, unknown> | undefined;
    const nonceId = msg ? String(msg["message_id"]) : cb ? String(cb["id"]) : null;
    if (nonceId && !checkNonce(nonceId, rateLimitConfig.windowMs)) {
      app.log.warn({ nonceId }, "Duplicate webhook message, skipping");
      return reply.code(200).send({ ok: true });
    }

    try {
      await runtime.handleIncomingMessage(request.body);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error(err, "Error handling webhook");
      return reply.code(200).send({ ok: true }); // Always 200 for Telegram
    }
  });

  // --- Managed channel webhook endpoint (multi-tenant) ---
  app.post("/webhook/managed/:webhookId", async (request, reply) => {
    if (!registry) {
      return reply.code(404).send({ error: "Managed channels not configured" });
    }

    const { webhookId } = request.params as { webhookId: string };
    const webhookPath = `/webhook/managed/${webhookId}`;
    const entry = registry.getByWebhookPath(webhookPath);

    if (!entry) {
      app.log.warn({ webhookPath }, "No managed runtime found for webhook path");
      return reply.code(200).send({ ok: true });
    }

    const payload = request.body as Record<string, unknown>;

    // Handle Slack URL verification challenge
    if (entry.channel === "slack" && payload["type"] === "url_verification") {
      return reply.code(200).send({ challenge: payload["challenge"] });
    }

    // Verify request signature
    const managedAdapter = entry.runtime.getAdapter();
    if (managedAdapter.verifyRequest) {
      const rawBody = JSON.stringify(request.body);
      const headers = request.headers as Record<string, string | undefined>;
      if (!managedAdapter.verifyRequest(rawBody, headers)) {
        app.log.warn({ webhookPath }, "Managed webhook request failed signature verification");
        return reply.code(200).send({ ok: true });
      }
    }

    // Rate limit by source IP
    const sourceIp = request.ip;
    if (!checkIngressRateLimit(sourceIp, rateLimitConfig)) {
      app.log.warn({ ip: sourceIp, webhookPath }, "Managed webhook rate limit exceeded");
      return reply.code(200).send({ ok: true });
    }

    // Nonce dedup
    const messageId = managedAdapter.extractMessageId(request.body);
    if (messageId && !checkNonce(`managed_${webhookId}_${messageId}`, rateLimitConfig.windowMs)) {
      app.log.warn({ messageId, webhookPath }, "Duplicate managed webhook message, skipping");
      return reply.code(200).send({ ok: true });
    }

    try {
      await entry.runtime.handleIncomingMessage(request.body);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      app.log.error(err, "Error handling managed webhook");
      return reply.code(200).send({ ok: true }); // Always 200 to prevent platform retries
    }
  });

  // --- Internal provision-notify endpoint ---
  app.post("/internal/provision-notify", async (request, reply) => {
    // Verify shared secret
    const internalSecret = process.env["INTERNAL_API_SECRET"];
    if (internalSecret) {
      const authHeader = request.headers["authorization"];
      if (authHeader !== `Bearer ${internalSecret}`) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
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

      await registry.provision(channel, prisma);
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
    cleanup();
    if (stopHealthChecker) stopHealthChecker();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await app.listen({ port, host });
    console.log(`Switchboard Chat webhook server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
