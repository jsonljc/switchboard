import { buildServer } from "./app.js";

async function main() {
  const server = await buildServer();
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  // Graceful shutdown — drain connections on SIGTERM/SIGINT
  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down gracefully`);
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await server.listen({ port, host });
    console.log(`Switchboard API server listening on ${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
