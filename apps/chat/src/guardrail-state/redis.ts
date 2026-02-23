import Redis from "ioredis";
import type { GuardrailStateStore, RateLimitEntry } from "@switchboard/core";

export class RedisGuardrailStateStore implements GuardrailStateStore {
  constructor(private redis: Redis) {}

  async getRateLimits(scopeKeys: string[]): Promise<Map<string, RateLimitEntry>> {
    const result = new Map<string, RateLimitEntry>();
    if (scopeKeys.length === 0) return result;

    const redisKeys = scopeKeys.map((k) => `guardrail:rl:${k}`);
    const values = await this.redis.mget(...redisKeys);

    for (let i = 0; i < scopeKeys.length; i++) {
      const raw = values[i];
      if (raw === null || raw === undefined) continue;
      const key = scopeKeys[i]!;
      try {
        const entry = JSON.parse(raw) as RateLimitEntry;
        result.set(key, entry);
      } catch {
        // Corrupted entry — skip
      }
    }
    return result;
  }

  async getCooldowns(entityKeys: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (entityKeys.length === 0) return result;

    const redisKeys = entityKeys.map((k) => `guardrail:cd:${k}`);
    const values = await this.redis.mget(...redisKeys);

    for (let i = 0; i < entityKeys.length; i++) {
      const raw = values[i];
      if (raw === null || raw === undefined) continue;
      const key = entityKeys[i]!;
      const timestamp = Number(raw);
      if (!Number.isFinite(timestamp)) continue;
      result.set(key, timestamp);
    }
    return result;
  }

  async setRateLimit(scopeKey: string, entry: RateLimitEntry, ttlMs: number): Promise<void> {
    await this.redis.set(
      `guardrail:rl:${scopeKey}`,
      JSON.stringify(entry),
      "PX",
      ttlMs,
    );
  }

  async setCooldown(entityKey: string, timestamp: number, ttlMs: number): Promise<void> {
    await this.redis.set(
      `guardrail:cd:${entityKey}`,
      String(timestamp),
      "PX",
      ttlMs,
    );
  }
}
