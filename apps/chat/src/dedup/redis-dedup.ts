// ---------------------------------------------------------------------------
// Webhook Deduplication — Redis-backed with in-memory fallback
// ---------------------------------------------------------------------------

import type Redis from "ioredis";

const DEDUP_TTL_SECONDS = 86400; // 24 hours
const IN_MEMORY_MAX_SIZE = 10_000;

let redisClient: Redis | null = null;
const inMemorySet = new Set<string>();

export function initDedup(redis: Redis): void {
  redisClient = redis;
}

/**
 * Returns true if this message has NOT been seen before (i.e. should be processed).
 * Returns false if it's a duplicate.
 */
export async function checkDedup(channel: string, messageId: string): Promise<boolean> {
  const key = `dedup:${channel}:${messageId}`;

  if (redisClient) {
    try {
      const result = await redisClient.set(key, "1", "EX", DEDUP_TTL_SECONDS, "NX");
      return result === "OK";
    } catch {
      // Redis error — fall through to in-memory
    }
  }

  // In-memory fallback
  if (inMemorySet.has(key)) {
    return false;
  }

  // Evict oldest entries if at capacity (simple FIFO via Set insertion order)
  if (inMemorySet.size >= IN_MEMORY_MAX_SIZE) {
    const first = inMemorySet.values().next().value;
    if (first !== undefined) inMemorySet.delete(first);
  }

  inMemorySet.add(key);
  return true;
}
