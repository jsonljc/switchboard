import { buildServer } from "./app.js";

async function main() {
  const server = await buildServer();
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  try {
    await server.listen({ port, host });
    console.log(`Switchboard API server listening on ${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
