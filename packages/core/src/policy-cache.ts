import type { Policy } from "@switchboard/schemas";

export const DEFAULT_POLICY_CACHE_TTL_MS = 60_000; // 1 minute

export interface PolicyCache {
  /**
   * Get cached active policies for cartridge (and optional org).
   * Returns null on miss.
   */
  get(cartridgeId: string, organizationId?: string | null): Promise<Policy[] | null>;
  /**
   * Store policies with TTL.
   */
  set(
    cartridgeId: string,
    organizationId: string | null,
    policies: Policy[],
    ttlMs: number,
  ): Promise<void>;
  /**
   * Invalidate cache: by cartridgeId (all keys for that cartridge), or all if no arg.
   */
  invalidate(cartridgeId?: string): Promise<void>;
}

function cacheKey(cartridgeId: string, organizationId: string | null): string {
  return `${cartridgeId}:${organizationId ?? "global"}`;
}

interface CacheEntry {
  policies: Policy[];
  expiresAt: number;
}

export class InMemoryPolicyCache implements PolicyCache {
  private store = new Map<string, CacheEntry>();

  async get(cartridgeId: string, organizationId?: string | null): Promise<Policy[] | null> {
    const key = cacheKey(cartridgeId, organizationId ?? null);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return [...entry.policies];
  }

  async set(
    cartridgeId: string,
    organizationId: string | null,
    policies: Policy[],
    ttlMs: number,
  ): Promise<void> {
    const key = cacheKey(cartridgeId, organizationId);
    this.store.set(key, {
      policies: [...policies],
      expiresAt: Date.now() + ttlMs,
    });
  }

  async invalidate(cartridgeId?: string): Promise<void> {
    if (!cartridgeId) {
      this.store.clear();
      return;
    }
    const prefix = cartridgeId + ":";
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}
