import type { SnapshotCacheStore } from "./types.js";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const MAX_ENTRIES = 1000;

/**
 * In-memory cache with lazy expiry on get() and max 1000 entries.
 */
export class InMemorySnapshotCache implements SnapshotCacheStore {
  private store = new Map<string, CacheEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.store.size >= MAX_ENTRIES && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}
