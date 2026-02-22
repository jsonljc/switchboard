import Fastify from "fastify";
import { createChatRuntime } from "./runtime.js";

async function main() {
  const app = Fastify({ logger: true });

  const runtime = await createChatRuntime();

  // Health check
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Telegram webhook endpoint
  app.post("/webhook/telegram", async (request, reply) => {
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

  try {
    await app.listen({ port, host });
    console.log(`Switchboard Chat webhook server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
