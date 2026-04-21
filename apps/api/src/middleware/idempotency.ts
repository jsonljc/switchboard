import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import Redis from "ioredis";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  statusCode: number;
  body: string;
  fingerprint: string;
}

function computeFingerprint(request: FastifyRequest): string {
  const method = request.method;
  const route = request.routerPath ?? request.routeOptions.url ?? request.url;
  const bodyHash = createHash("sha256")
    .update(JSON.stringify(request.body ?? null))
    .digest("hex");
  return `${method}:${route}:${bodyHash}`;
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

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return;

    if (idempotencyKey.length > 256) {
      return reply.code(400).send({ error: "Idempotency-Key exceeds maximum length of 256" });
    }

    const cached = await backend.get(idempotencyKey);
    if (!cached) return;

    const entry = JSON.parse(cached) as CacheEntry;
    const currentFingerprint = computeFingerprint(request);

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

      const entry: CacheEntry = {
        statusCode: reply.statusCode,
        body: payload,
        fingerprint: computeFingerprint(request),
      };
      await backend.set(idempotencyKey, JSON.stringify(entry), WINDOW_MS);
    }

    return payload;
  });
};

export const idempotencyMiddleware = fp(idempotencyPlugin);
