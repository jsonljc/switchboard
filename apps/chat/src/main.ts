import Fastify from "fastify";
import { createChatRuntime } from "./runtime.js";
import { checkIngressRateLimit } from "./adapters/security.js";

async function main() {
  const app = Fastify({ logger: true });

  const runtime = await createChatRuntime();

  // Webhook secret for Telegram (set via TELEGRAM_WEBHOOK_SECRET env var)
  const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"] ?? "";

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

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Telegram webhook endpoint
  app.post("/webhook/telegram", async (request, reply) => {
    // Verify webhook secret if configured
    if (webhookSecret) {
      const token = request.headers["x-telegram-bot-api-secret-token"] as string | undefined;
      if (token !== webhookSecret) {
        app.log.warn("Webhook request with invalid or missing secret token");
        return reply.code(200).send({ ok: true }); // 200 to avoid Telegram retries
      }
    }

    // Rate limit by source IP
    const sourceIp = request.ip;
    if (!checkIngressRateLimit(sourceIp, rateLimitConfig)) {
      app.log.warn({ ip: sourceIp }, "Webhook rate limit exceeded");
      return reply.code(200).send({ ok: true }); // 200 to avoid Telegram retries
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
