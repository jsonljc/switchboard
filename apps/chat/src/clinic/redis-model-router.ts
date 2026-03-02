import type Redis from "ioredis";
import type { ModelRouter, ModelRouterConfig, TokenUsageSummary } from "./model-router-types.js";

/**
 * Redis-backed model router with per-org token tracking.
 *
 * Redis key: `tokenusage:{orgId}:{YYYY-MM-DD}` → HASH { prompt: N, completion: N }
 * Uses HINCRBY for atomic increments, HGETALL for reads.
 * TTL: 90 days per daily key (auto-expire).
 * Fail-open: all Redis errors caught, return safe defaults.
 */
export class RedisModelRouter implements ModelRouter {
  private config: ModelRouterConfig;
  private redis: Redis;
  private static TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

  constructor(config: ModelRouterConfig, redis: Redis) {
    this.config = config;
    this.redis = redis;
  }

  async shouldUseLLM(orgId?: string): Promise<boolean> {
    try {
      const usage = await this.getTodayUsage(orgId);
      return usage < this.config.dailyTokenBudget;
    } catch {
      return true; // fail-open
    }
  }

  async recordUsage(promptTokens: number, completionTokens: number, orgId?: string): Promise<void> {
    try {
      const key = this.dayKey(orgId);
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(key, "prompt", promptTokens);
      pipeline.hincrby(key, "completion", completionTokens);
      pipeline.expire(key, RedisModelRouter.TTL_SECONDS);
      await pipeline.exec();
    } catch {
      // fail-open: swallow Redis errors
    }
  }

  async getTodayUsage(orgId?: string): Promise<number> {
    try {
      const key = this.dayKey(orgId);
      const data = await this.redis.hgetall(key);
      return (parseInt(data["prompt"] ?? "0", 10) || 0) +
             (parseInt(data["completion"] ?? "0", 10) || 0);
    } catch {
      return 0; // fail-open
    }
  }

  async getRemainingBudget(orgId?: string): Promise<number> {
    const usage = await this.getTodayUsage(orgId);
    return Math.max(0, this.config.dailyTokenBudget - usage);
  }

  async getUsageSummary(orgId: string, period: "daily" | "weekly" | "monthly"): Promise<TokenUsageSummary> {
    try {
      const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
      const keys = this.lastNDayKeys(orgId, days);

      let promptTokens = 0;
      let completionTokens = 0;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.hgetall(key);
      }
      const results = await pipeline.exec();

      if (results) {
        for (const [err, data] of results) {
          if (err || !data) continue;
          const hash = data as Record<string, string>;
          promptTokens += parseInt(hash["prompt"] ?? "0", 10) || 0;
          completionTokens += parseInt(hash["completion"] ?? "0", 10) || 0;
        }
      }

      return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    } catch {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
  }

  get clinicId(): string {
    return this.config.clinicId;
  }

  private dayKey(orgId?: string, date?: Date): string {
    const d = date ?? new Date();
    const dateStr = d.toISOString().slice(0, 10);
    const org = orgId ?? this.config.clinicId;
    return `tokenusage:${org}:${dateStr}`;
  }

  private lastNDayKeys(orgId: string, n: number): string[] {
    const keys: string[] = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      keys.push(this.dayKey(orgId, d));
    }
    return keys;
  }
}
