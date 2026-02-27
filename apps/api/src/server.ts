import { buildServer } from "./app.js";

async function main() {
  const server = await buildServer();
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  const SHUTDOWN_TIMEOUT_MS = 30_000;

  // Graceful shutdown — drain connections on SIGTERM/SIGINT
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down gracefully`);

    // Hard timeout: force exit if close doesn't complete in time
    const forceTimer = setTimeout(() => {
      server.log.warn(`Shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      await server.close();
    } catch (err) {
      server.log.error({ err }, "Error during graceful shutdown");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await server.listen({ port, host });
    server.log.info({ host, port }, "Switchboard API server listening");
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
