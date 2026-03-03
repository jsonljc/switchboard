import type Redis from "ioredis";
import type { ModelRouter, ModelRouterConfig, TokenUsageSummary } from "./model-router-types.js";
import { computeTokenCostUSD } from "@switchboard/core";

/**
 * Redis-backed model router with per-org token + cost tracking.
 *
 * Redis keys:
 *   tokenusage:{orgId}:{YYYY-MM-DD} → HASH { prompt: N, completion: N }
 *   tokencost:{orgId}:{YYYY-MM-DD}  → STRING (accumulated USD cost × 1_000_000 as integer for precision)
 *
 * Uses HINCRBY for atomic token increments, INCRBY for cost accumulation.
 * TTL: 90 days per key (auto-expire).
 * Fail-open: all Redis errors caught, return safe defaults.
 */
export class RedisModelRouter implements ModelRouter {
  private config: ModelRouterConfig;
  private redis: Redis;
  private static TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
  private static COST_PRECISION = 1_000_000; // Store cost as micro-dollars for integer precision

  constructor(config: ModelRouterConfig, redis: Redis) {
    this.config = config;
    this.redis = redis;
  }

  async shouldUseLLM(orgId?: string): Promise<boolean> {
    try {
      // If USD budget is set, check cost-based budget
      if (this.config.dailyBudgetUSD != null) {
        const costUSD = await this.getTodayCostUSD(orgId);
        return costUSD < this.config.dailyBudgetUSD;
      }
      // Fallback to token-based budget
      const usage = await this.getTodayUsage(orgId);
      return usage < this.config.dailyTokenBudget;
    } catch {
      // Fail-closed: on Redis error, deny LLM usage to prevent unbounded spend
      console.warn("[RedisModelRouter] Redis error in shouldUseLLM — failing closed (denying LLM)");
      return false;
    }
  }

  async recordUsage(
    promptTokens: number,
    completionTokens: number,
    orgId?: string,
    modelId?: string,
  ): Promise<void> {
    try {
      const tokenKey = this.dayKey(orgId);
      const costKey = this.costDayKey(orgId);
      const cost = computeTokenCostUSD(promptTokens, completionTokens, modelId);
      const microDollars = Math.round(cost.totalCost * RedisModelRouter.COST_PRECISION);

      const pipeline = this.redis.pipeline();
      pipeline.hincrby(tokenKey, "prompt", promptTokens);
      pipeline.hincrby(tokenKey, "completion", completionTokens);
      pipeline.expire(tokenKey, RedisModelRouter.TTL_SECONDS);
      pipeline.incrby(costKey, microDollars);
      pipeline.expire(costKey, RedisModelRouter.TTL_SECONDS);
      await pipeline.exec();
    } catch {
      // fail-open: swallow Redis errors
    }
  }

  async getTodayUsage(orgId?: string): Promise<number> {
    try {
      const key = this.dayKey(orgId);
      const data = await this.redis.hgetall(key);
      return (
        (parseInt(data["prompt"] ?? "0", 10) || 0) + (parseInt(data["completion"] ?? "0", 10) || 0)
      );
    } catch {
      return 0; // fail-open
    }
  }

  async getTodayCostUSD(orgId?: string): Promise<number> {
    try {
      const key = this.costDayKey(orgId);
      const raw = await this.redis.get(key);
      const microDollars = parseInt(raw ?? "0", 10) || 0;
      return microDollars / RedisModelRouter.COST_PRECISION;
    } catch {
      return 0; // fail-open
    }
  }

  async getRemainingBudget(orgId?: string): Promise<number> {
    const usage = await this.getTodayUsage(orgId);
    return Math.max(0, this.config.dailyTokenBudget - usage);
  }

  async getUsageSummary(
    orgId: string,
    period: "daily" | "weekly" | "monthly",
  ): Promise<TokenUsageSummary> {
    try {
      const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
      const tokenKeys = this.lastNDayKeys(orgId, days);
      const costKeys = this.lastNCostDayKeys(orgId, days);

      let promptTokens = 0;
      let completionTokens = 0;
      let totalMicroDollars = 0;

      const pipeline = this.redis.pipeline();
      for (const key of tokenKeys) {
        pipeline.hgetall(key);
      }
      for (const key of costKeys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();

      if (results) {
        // First N results are token hashes
        for (let i = 0; i < tokenKeys.length; i++) {
          const [err, data] = results[i]!;
          if (err || !data) continue;
          const hash = data as Record<string, string>;
          promptTokens += parseInt(hash["prompt"] ?? "0", 10) || 0;
          completionTokens += parseInt(hash["completion"] ?? "0", 10) || 0;
        }
        // Next N results are cost strings
        for (let i = tokenKeys.length; i < tokenKeys.length + costKeys.length; i++) {
          const [err, data] = results[i]!;
          if (err || !data) continue;
          totalMicroDollars += parseInt(data as string, 10) || 0;
        }
      }

      return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUSD: totalMicroDollars / RedisModelRouter.COST_PRECISION,
      };
    } catch {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUSD: 0 };
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

  private costDayKey(orgId?: string, date?: Date): string {
    const d = date ?? new Date();
    const dateStr = d.toISOString().slice(0, 10);
    const org = orgId ?? this.config.clinicId;
    return `tokencost:${org}:${dateStr}`;
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

  private lastNCostDayKeys(orgId: string, n: number): string[] {
    const keys: string[] = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      keys.push(this.costDayKey(orgId, d));
    }
    return keys;
  }
}
