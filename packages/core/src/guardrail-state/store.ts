export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface GuardrailStateStore {
  getRateLimits(scopeKeys: string[]): Promise<Map<string, RateLimitEntry>>;
  getCooldowns(entityKeys: string[]): Promise<Map<string, number>>;
  setRateLimit(scopeKey: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
  setCooldown(entityKey: string, timestamp: number, ttlMs: number): Promise<void>;
}
