import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export interface ApiKeyMetadata {
  organizationId?: string;
  runtimeId?: string;
}

/**
 * API key authentication middleware.
 *
 * Validates Bearer tokens from the Authorization header against a set of
 * configured API keys. When no keys are configured (API_KEYS env var unset),
 * authentication is disabled — this allows frictionless local development.
 *
 * Optional API_KEY_METADATA: comma-separated entries "key:orgId:runtimeId" (empty parts allowed).
 * When present, attaches organizationIdFromAuth and runtimeIdFromAuth to the request for audit/routing.
 *
 * Excluded paths: /health, /docs (Swagger UI and OpenAPI spec)
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  const apiKeys = loadApiKeys();
  const metadata = loadApiKeyMetadata();

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

    const key = match[1];
    if (!apiKeys.has(key)) {
      return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
    }

    const meta = metadata.get(key);
    if (meta) {
      request.organizationIdFromAuth = meta.organizationId;
      request.runtimeIdFromAuth = meta.runtimeId;
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

/**
 * Load optional per-key metadata from API_KEY_METADATA.
 * Format: "key:orgId:runtimeId,key2:org2:runtime2" (empty org or runtime allowed, e.g. "key::runtime1")
 */
function loadApiKeyMetadata(): Map<string, ApiKeyMetadata> {
  const raw = process.env["API_KEY_METADATA"] ?? "";
  if (!raw.trim()) return new Map();

  const out = new Map<string, ApiKeyMetadata>();
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const parts = entry.split(":");
    const key = parts[0]?.trim();
    if (!key) continue;
    const organizationId = parts[1]?.trim() || undefined;
    const runtimeId = parts[2]?.trim() || undefined;
    out.set(key, { organizationId, runtimeId });
  }
  return out;
}
