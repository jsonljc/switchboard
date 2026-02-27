import Fastify from "fastify";
import { createChatRuntime } from "./runtime.js";
import { checkIngressRateLimit, checkNonce } from "./adapters/security.js";

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
      timestamp: new Date().toISOString(),
    };
  });

  // Telegram webhook endpoint
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

  const port = parseInt(process.env["CHAT_PORT"] ?? "3001", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  // Graceful shutdown — drain connections on SIGTERM/SIGINT
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
    cleanup();
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
