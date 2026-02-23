import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

/**
 * API key authentication middleware.
 *
 * Validates Bearer tokens from the Authorization header against a set of
 * configured API keys. When no keys are configured (API_KEYS env var unset),
 * authentication is disabled — this allows frictionless local development.
 *
 * Excluded paths: /health, /docs (Swagger UI and OpenAPI spec)
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  const apiKeys = loadApiKeys();

  // If no keys configured, skip auth entirely (development mode)
  if (apiKeys.size === 0) {
    if (process.env.NODE_ENV === "production") {
      app.log.error("API_KEYS not set — authentication disabled in production. Set API_KEYS env var.");
    }
    return;
  }

  app.addHook("preHandler", async (request, reply) => {
    // Skip auth for health check and docs
    if (
      request.url === "/health" ||
      request.url.startsWith("/docs")
    ) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "Missing Authorization header", statusCode: 401 });
    }

    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match?.[1]) {
      return reply.code(401).send({ error: "Invalid Authorization format, expected: Bearer <key>", statusCode: 401 });
    }

    if (!apiKeys.has(match[1])) {
      return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
    }
  });
};

export const authMiddleware = fp(authPlugin, { name: "auth-middleware" });

function loadApiKeys(): Set<string> {
  const raw = process.env["API_KEYS"] ?? "";
  if (!raw.trim()) return new Set();

  return new Set(
    raw.split(",").map((k) => k.trim()).filter(Boolean),
  );
}
