import type { SnapshotCacheStore } from "./types.js";

/**
 * Redis-backed snapshot cache. Fail-open on errors.
 *
 * Accepts any object with get/set methods matching ioredis's Redis interface
 * so we don't need ioredis as a direct dependency of this cartridge.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", ttl: number): Promise<unknown>;
}

export class RedisSnapshotCache implements SnapshotCacheStore {
  constructor(private redis: RedisLike) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null; // fail-open
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    try {
      await this.redis.set(key, value, "PX", ttlMs);
    } catch {
      // fail-open: swallow Redis errors
    }
  }
}
