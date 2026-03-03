import { createHash } from "node:crypto";
import type { SnapshotCacheStore } from "./types.js";
import type { PlatformClient, PlatformType } from "../types.js";
import type {
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  SubEntityBreakdown,
  TimeRange,
} from "../../core/types.js";

/** Default TTLs per platform (milliseconds). */
const DEFAULT_TTLS: Record<PlatformType, number> = {
  meta: 10 * 60 * 1000, // 10 min
  google: 15 * 60 * 1000, // 15 min
  tiktok: 10 * 60 * 1000, // 10 min
};

/**
 * Decorator that wraps a PlatformClient with transparent snapshot caching.
 *
 * Cache key: SHA-256 of `{platform}:{entityId}:{entityLevel}:{since}:{until}`
 * Stored under `cache:snapshot:{hash}`.
 */
export class CachedPlatformClient implements PlatformClient {
  private inner: PlatformClient;
  private cache: SnapshotCacheStore;
  private ttlMs: number;

  constructor(inner: PlatformClient, cache: SnapshotCacheStore, ttlMs?: number) {
    this.inner = inner;
    this.cache = cache;
    this.ttlMs = ttlMs ?? DEFAULT_TTLS[inner.platform] ?? 10 * 60 * 1000;

    // Delegate optional method if inner client supports it
    if (inner.fetchSubEntityBreakdowns) {
      this.fetchSubEntityBreakdowns = (
        entityId: string,
        entityLevel: EntityLevel,
        timeRange: TimeRange,
        funnel: FunnelSchema,
      ) => inner.fetchSubEntityBreakdowns!(entityId, entityLevel, timeRange, funnel);
    }
  }

  get platform(): PlatformType {
    return this.inner.platform;
  }

  async fetchSnapshot(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
  ): Promise<MetricSnapshot> {
    const key = this.buildKey(entityId, entityLevel, timeRange);

    // Try cache
    const cached = await this.cache.get(key);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as MetricSnapshot;
      } catch {
        // Corrupted cache entry — fall through to fetch
      }
    }

    // Cache miss — fetch from upstream
    const snapshot = await this.inner.fetchSnapshot(entityId, entityLevel, timeRange, funnel);

    // Store in cache (non-blocking, fail-open)
    this.cache.set(key, JSON.stringify(snapshot), this.ttlMs).catch(() => {});

    return snapshot;
  }

  async fetchComparisonSnapshots(
    entityId: string,
    entityLevel: EntityLevel,
    current: TimeRange,
    previous: TimeRange,
    funnel: FunnelSchema,
  ): Promise<{ current: MetricSnapshot; previous: MetricSnapshot }> {
    // Both snapshots go through the cache individually
    const [currentSnapshot, previousSnapshot] = await Promise.all([
      this.fetchSnapshot(entityId, entityLevel, current, funnel),
      this.fetchSnapshot(entityId, entityLevel, previous, funnel),
    ]);
    return { current: currentSnapshot, previous: previousSnapshot };
  }

  fetchSubEntityBreakdowns?(
    entityId: string,
    entityLevel: EntityLevel,
    timeRange: TimeRange,
    funnel: FunnelSchema,
  ): Promise<SubEntityBreakdown[]>;

  private buildKey(entityId: string, entityLevel: EntityLevel, timeRange: TimeRange): string {
    const raw = `${this.inner.platform}:${entityId}:${entityLevel}:${timeRange.since}:${timeRange.until}`;
    const hash = createHash("sha256").update(raw).digest("hex").slice(0, 32);
    return `cache:snapshot:${hash}`;
  }
}
