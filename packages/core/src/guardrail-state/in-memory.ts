import type { GuardrailStateStore, RateLimitEntry } from "./store.js";

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryGuardrailStateStore implements GuardrailStateStore {
  private rateLimits = new Map<string, TimedEntry<RateLimitEntry>>();
  private cooldowns = new Map<string, TimedEntry<number>>();

  async getRateLimits(scopeKeys: string[]): Promise<Map<string, RateLimitEntry>> {
    const result = new Map<string, RateLimitEntry>();
    const now = Date.now();
    for (const key of scopeKeys) {
      const entry = this.rateLimits.get(key);
      if (!entry) continue;
      if (entry.expiresAt <= now) {
        this.rateLimits.delete(key);
        continue;
      }
      result.set(key, entry.value);
    }
    return result;
  }

  async getCooldowns(entityKeys: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const now = Date.now();
    for (const key of entityKeys) {
      const entry = this.cooldowns.get(key);
      if (!entry) continue;
      if (entry.expiresAt <= now) {
        this.cooldowns.delete(key);
        continue;
      }
      result.set(key, entry.value);
    }
    return result;
  }

  async setRateLimit(scopeKey: string, entry: RateLimitEntry, ttlMs: number): Promise<void> {
    this.rateLimits.set(scopeKey, { value: entry, expiresAt: Date.now() + ttlMs });
  }

  async setCooldown(entityKey: string, timestamp: number, ttlMs: number): Promise<void> {
    this.cooldowns.set(entityKey, { value: timestamp, expiresAt: Date.now() + ttlMs });
  }
}
