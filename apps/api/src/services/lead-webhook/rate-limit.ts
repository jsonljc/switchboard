import type Redis from "ioredis";

const PER_MINUTE = 60;
const PER_HOUR = 600;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkRateLimit(
  redis: Redis | null,
  tokenHash: string,
): Promise<RateLimitResult> {
  if (!redis) return { allowed: true };

  const minKey = `lwh:rl:m:${tokenHash}`;
  const hourKey = `lwh:rl:h:${tokenHash}`;

  const minCount = await redis.incr(minKey);
  if (minCount === 1) await redis.pexpire(minKey, 60_000);

  const hourCount = await redis.incr(hourKey);
  if (hourCount === 1) await redis.pexpire(hourKey, 3_600_000);

  if (minCount > PER_MINUTE) {
    const ttl = await redis.pttl(minKey);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
  }
  if (hourCount > PER_HOUR) {
    const ttl = await redis.pttl(hourKey);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
  }
  return { allowed: true };
}
