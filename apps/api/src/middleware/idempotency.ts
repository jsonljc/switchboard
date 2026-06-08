import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  statusCode: number;
  body: string;
  fingerprint: string;
}

function computeFingerprint(request: FastifyRequest): string {
  const method = request.method;
  const route =
    (request as unknown as Record<string, string>).routerPath ??
    request.routeOptions?.url ??
    request.url;
  const orgId =
    request.organizationIdFromAuth ?? (request.headers["x-organization-id"] as string) ?? "";
  const actorId =
    request.principalIdFromAuth ?? (request.headers["x-principal-id"] as string) ?? "";
  const bodyHash = createHash("sha256")
    .update(JSON.stringify(request.body ?? null))
    .digest("hex");
  return `${method}:${route}:${orgId}:${actorId}:${bodyHash}`;
}

export interface IdempotencyBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export class MemoryBackend implements IdempotencyBackend {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

export class RedisBackend implements IdempotencyBackend {
  constructor(private redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(`idempotency:${key}`);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(`idempotency:${key}`, value, "PX", ttlMs);
  }
}

export function createBackend(sharedRedis?: Redis): IdempotencyBackend {
  if (sharedRedis) {
    return new RedisBackend(sharedRedis);
  }
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    return new RedisBackend(new Redis(redisUrl));
  }
  return new MemoryBackend();
}

const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  const sharedRedis = (app as unknown as Record<string, unknown>)["redis"] as Redis | undefined;
  const backend = createBackend(sharedRedis);

  // The fingerprint is computed in the preHandler (CHECK leg) and stashed here so the
  // onSend (STORE leg) reuses the exact same value rather than recomputing it. This
  // makes the two legs symmetric by construction even when a LATER route-scoped
  // preHandler mutates a fingerprint input — e.g. dev-mode `buildDevAuthFallback`
  // defaulting org/actor to "default" after the global idempotency check. Recomputing
  // at store would capture those late-defaulted values and 409 a legitimate replay
  // whose check leg saw the still-unset values (#575).
  const checkTimeFingerprints = new WeakMap<FastifyRequest, string>();

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return;

    if (idempotencyKey.length > 256) {
      return reply.code(400).send({ error: "Idempotency-Key exceeds maximum length of 256" });
    }

    // Compute + stash now (before route-scoped preHandlers run) so the store leg can
    // reuse this exact fingerprint. Header-supplied identity is already resolved here
    // by the global buildDevAuthFallback, preserving the cross-tenant guard.
    const currentFingerprint = computeFingerprint(request);
    checkTimeFingerprints.set(request, currentFingerprint);

    const cached = await backend.get(idempotencyKey);
    if (!cached) return;

    const entry = JSON.parse(cached) as CacheEntry;

    if (entry.fingerprint !== currentFingerprint) {
      return reply.code(409).send({
        error: "Idempotency-Key reused with different request",
      });
    }

    return reply.code(entry.statusCode).send(JSON.parse(entry.body));
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "POST") return payload;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return payload;

    if (typeof payload === "string") {
      const existing = await backend.get(idempotencyKey);
      if (existing) return payload;

      // Reuse the CHECK-time fingerprint (stashed in preHandler); fall back to a fresh
      // computation only if the preHandler never ran for this request (defensive).
      const fingerprint = checkTimeFingerprints.get(request) ?? computeFingerprint(request);
      const entry: CacheEntry = {
        statusCode: reply.statusCode,
        body: payload,
        fingerprint,
      };
      await backend.set(idempotencyKey, JSON.stringify(entry), WINDOW_MS);
    }

    return payload;
  });
};

export const idempotencyMiddleware = fp(idempotencyPlugin);
