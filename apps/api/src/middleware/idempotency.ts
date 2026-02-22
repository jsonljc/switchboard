import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import Redis from "ioredis";

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

export function createBackend(): IdempotencyBackend {
  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    return new RedisBackend(new Redis(redisUrl));
  }
  return new MemoryBackend();
}

const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  const backend = createBackend();

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "POST") return;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return;

    const cached = await backend.get(idempotencyKey);
    if (cached) {
      const entry = JSON.parse(cached) as { statusCode: number; body: string };
      return reply.code(entry.statusCode).send(JSON.parse(entry.body));
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method !== "POST") return payload;

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) return payload;

    if (typeof payload === "string") {
      const entry = JSON.stringify({ statusCode: reply.statusCode, body: payload });
      await backend.set(idempotencyKey, entry, WINDOW_MS);
    }

    return payload;
  });
};

export const idempotencyMiddleware = fp(idempotencyPlugin);
