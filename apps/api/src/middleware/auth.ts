import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import crypto from "node:crypto";

export interface ApiKeyMetadata {
  organizationId?: string;
  runtimeId?: string;
  principalId?: string;
}

interface HashedKeyEntry {
  hash: Buffer;
  metadata?: ApiKeyMetadata;
}

interface DbKeyCache {
  metadata: ApiKeyMetadata;
  expiresAt: number;
}

const DB_KEY_TTL_MS = 60_000; // 60s cache TTL

function hashKey(key: string): Buffer {
  return crypto.createHash("sha256").update(key).digest();
}

/**
 * API key authentication middleware.
 *
 * Keys are SHA-256 hashed on load. Incoming keys are hashed and compared
 * using timing-safe comparison to prevent timing attacks.
 *
 * Supports two auth sources:
 * 1. Static env-var keys (fast path, no DB hit)
 * 2. Dashboard-generated keys (DB fallback with 60s in-memory cache)
 *
 * Supports SIGHUP-based hot reload: sending SIGHUP re-reads API_KEYS and
 * API_KEY_METADATA environment variables and replaces the key set atomically.
 *
 * Excluded paths: /health, /metrics, /docs (Swagger UI and OpenAPI spec)
 */
const authPlugin: FastifyPluginAsync = async (app) => {
  let keyEntries = loadHashedKeys();

  // In-memory cache for DB-validated keys (keyed by hex hash)
  const dbKeyCache = new Map<string, DbKeyCache>();

  // If no keys configured and no DB, skip auth entirely (development mode)
  const hasDb = !!app.prisma;
  if (keyEntries.length === 0 && !hasDb) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "API_KEYS environment variable is required in production. " +
        "Set API_KEYS to a comma-separated list of valid API keys, or set NODE_ENV to something other than 'production'.",
      );
    }
    return;
  }

  // SIGHUP handler for hot-reloading API keys without restart
  const reloadHandler = () => {
    const newEntries = loadHashedKeys();
    keyEntries = newEntries;
    app.log.info({ keyCount: newEntries.length }, "API keys reloaded via SIGHUP");
  };
  process.on("SIGHUP", reloadHandler);

  // Clean up SIGHUP listener on close
  app.addHook("onClose", async () => {
    process.removeListener("SIGHUP", reloadHandler);
  });

  app.addHook("preHandler", async (request, reply) => {
    // Skip auth for health check, metrics, and docs
    if (
      request.url === "/health" ||
      request.url === "/metrics" ||
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

    const incomingKey = match[1];
    const incomingHash = hashKey(incomingKey);

    // Fast path: check static env-var keys first
    let matchedEntry: HashedKeyEntry | undefined;
    for (const entry of keyEntries) {
      if (entry.hash.length === incomingHash.length && crypto.timingSafeEqual(entry.hash, incomingHash)) {
        matchedEntry = entry;
        break;
      }
    }

    if (matchedEntry) {
      if (matchedEntry.metadata) {
        request.organizationIdFromAuth = matchedEntry.metadata.organizationId;
        request.runtimeIdFromAuth = matchedEntry.metadata.runtimeId;
        request.principalIdFromAuth = matchedEntry.metadata.principalId;
      }
      return;
    }

    // DB fallback: check dashboard-generated keys
    if (app.prisma) {
      const hashHex = incomingHash.toString("hex");

      // Check in-memory cache first
      const cached = dbKeyCache.get(hashHex);
      if (cached && cached.expiresAt > Date.now()) {
        request.organizationIdFromAuth = cached.metadata.organizationId;
        request.principalIdFromAuth = cached.metadata.principalId;
        return;
      }

      // Query DB
      try {
        const user = await app.prisma.dashboardUser.findFirst({
          where: { apiKeyHash: hashHex },
          select: { organizationId: true, principalId: true },
        });

        if (user) {
          const metadata: ApiKeyMetadata = {
            organizationId: user.organizationId,
            principalId: user.principalId,
          };
          // Cache the result
          dbKeyCache.set(hashHex, { metadata, expiresAt: Date.now() + DB_KEY_TTL_MS });
          request.organizationIdFromAuth = metadata.organizationId;
          request.principalIdFromAuth = metadata.principalId;
          return;
        }
      } catch (err) {
        app.log.warn({ err }, "DB key lookup failed, falling through to 401");
      }
    }

    return reply.code(401).send({ error: "Invalid API key", statusCode: 401 });
  });
};

export const authMiddleware = fp(authPlugin, { name: "auth-middleware" });

/**
 * Load API keys and their metadata, returning hashed entries.
 */
function loadHashedKeys(): HashedKeyEntry[] {
  const rawKeys = process.env["API_KEYS"] ?? "";
  if (!rawKeys.trim()) return [];

  const keys = rawKeys.split(",").map((k) => k.trim()).filter(Boolean);
  const metadata = loadApiKeyMetadata();

  return keys.map((key) => ({
    hash: hashKey(key),
    metadata: metadata.get(key),
  }));
}

/**
 * Load optional per-key metadata from API_KEY_METADATA.
 * Format: "key:orgId:runtimeId:principalId" (empty parts allowed, e.g. "key:::principal1")
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
    const principalId = parts[3]?.trim() || undefined;
    out.set(key, { organizationId, runtimeId, principalId });
  }
  return out;
}
