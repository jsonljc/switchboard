export type { SnapshotCacheStore } from "./types.js";
export { InMemorySnapshotCache } from "./in-memory-cache.js";
export { RedisSnapshotCache } from "./redis-cache.js";
export type { RedisLike } from "./redis-cache.js";
export { CachedPlatformClient } from "./cached-client.js";

import type { SnapshotCacheStore } from "./types.js";
import { InMemorySnapshotCache } from "./in-memory-cache.js";
import { RedisSnapshotCache } from "./redis-cache.js";
import type { RedisLike } from "./redis-cache.js";

/**
 * Create a SnapshotCacheStore backed by Redis (if available) or in-memory fallback.
 */
export function createSnapshotCacheStore(redis?: RedisLike): SnapshotCacheStore {
  if (redis) {
    return new RedisSnapshotCache(redis);
  }
  return new InMemorySnapshotCache();
}
