// NOTE: @experimental — Unused in production. Wire into LLMInterpreter.callLLM() to enable response caching.
// Preserved for potential future use as an LLM response deduplication layer.

import { createHash } from "node:crypto";

/**
 * Cached LLM response entry.
 */
interface CacheEntry {
  response: string;
  cachedAt: number;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * LLMResponseCache — caches identical LLM queries to avoid redundant API calls.
 *
 * Key: sha256(model + systemPrompt + userMessage)
 * TTL: 5 minutes for read queries, never cache write intents.
 * Backend: Redis when available, in-memory Map fallback.
 */
export class LLMResponseCache {
  private memoryCache = new Map<string, CacheEntry>();
  private redis: import("ioredis").default | null = null;
  private ttlMs: number;
  private maxMemoryEntries: number;
  private static readonly REDIS_PREFIX = "llmcache:";

  constructor(config?: {
    redis?: import("ioredis").default;
    /** Cache TTL in milliseconds (default: 5 minutes) */
    ttlMs?: number;
    /** Max entries in memory cache (default: 1000) */
    maxMemoryEntries?: number;
  }) {
    this.redis = config?.redis ?? null;
    this.ttlMs = config?.ttlMs ?? 5 * 60 * 1000;
    this.maxMemoryEntries = config?.maxMemoryEntries ?? 1000;
  }

  /**
   * Generate cache key from model + prompt content.
   */
  static cacheKey(model: string, systemPrompt: string, userMessage: string): string {
    const hash = createHash("sha256");
    hash.update(model);
    hash.update(systemPrompt);
    hash.update(userMessage);
    return hash.digest("hex");
  }

  /**
   * Get cached response, or null if not found/expired.
   */
  async get(key: string): Promise<CacheEntry | null> {
    // Try Redis first
    if (this.redis) {
      try {
        const raw = await this.redis.get(LLMResponseCache.REDIS_PREFIX + key);
        if (raw) {
          return JSON.parse(raw) as CacheEntry;
        }
      } catch {
        // Fall through to memory cache
      }
    }

    // Memory cache fallback
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Store a response in the cache.
   */
  async set(
    key: string,
    response: string,
    usage?: { promptTokens: number; completionTokens: number },
  ): Promise<void> {
    const entry: CacheEntry = {
      response,
      cachedAt: Date.now(),
      usage,
    };

    // Redis
    if (this.redis) {
      try {
        const ttlSeconds = Math.ceil(this.ttlMs / 1000);
        await this.redis.setex(
          LLMResponseCache.REDIS_PREFIX + key,
          ttlSeconds,
          JSON.stringify(entry),
        );
      } catch {
        // Fall through to memory
      }
    }

    // Memory cache with eviction
    if (this.memoryCache.size >= this.maxMemoryEntries) {
      // Evict oldest entry
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) this.memoryCache.delete(firstKey);
    }
    this.memoryCache.set(key, entry);
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    // Don't clear Redis — let TTL handle it
  }

  /**
   * Get cache stats.
   */
  stats(): { memoryEntries: number; ttlMs: number } {
    return {
      memoryEntries: this.memoryCache.size,
      ttlMs: this.ttlMs,
    };
  }
}
