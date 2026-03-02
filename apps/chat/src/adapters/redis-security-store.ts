import type { SecurityStore } from "./security-store.js";

interface RedisClient {
  set(...args: Array<string | number | Buffer>): Promise<string | null>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

export class RedisSecurityStore implements SecurityStore {
  constructor(private redis: RedisClient) {}

  async checkNonce(nonce: string, ttlMs: number): Promise<boolean> {
    try {
      const key = `nonce:${nonce}`;
      const result = await this.redis.set(key, "1", "PX", ttlMs, "NX");
      return result === "OK"; // "OK" = new (allowed), null = duplicate
    } catch (err) {
      console.warn("[RedisSecurityStore] checkNonce failed, allowing request:", err);
      return true; // Fail-open
    }
  }

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await this.redis.incr(redisKey);
      // Set expiry only on first increment (when TTL is -1, meaning no expiry set)
      const ttl = await this.redis.ttl(redisKey);
      if (ttl === -1) {
        await this.redis.pexpire(redisKey, windowMs);
      }
      return count <= limit;
    } catch (err) {
      console.warn("[RedisSecurityStore] checkRateLimit failed, allowing request:", err);
      return true; // Fail-open
    }
  }
}
