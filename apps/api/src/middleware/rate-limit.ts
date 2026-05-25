// ---------------------------------------------------------------------------
// Endpoint-specific rate limiting — stricter limits for auth/billing endpoints
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import crypto from "node:crypto";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const AUTH_RATE_LIMIT_MAX = 5;
const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

/** Sensitive route prefixes that get stricter rate limits. */
const SENSITIVE_PREFIXES = ["/api/auth", "/api/setup/bootstrap", "/api/billing/checkout"];

/**
 * Rate-limit dimensions for a request. Always includes the source IP. When the
 * request presents a credential (Authorization header), a second per-credential
 * dimension is added so an attacker rotating source IPs while reusing one stolen
 * key still hits the limit (AU-4 — was per-IP only).
 *
 * The credential is hashed, never stored verbatim, so the bucket key (which may
 * land in Redis or logs) never contains the secret.
 */
function rateLimitDimensions(request: FastifyRequest): string[] {
  const dimensions = [`ip:${request.ip}`];
  const authorization = request.headers.authorization;
  if (authorization) {
    const credentialHash = crypto
      .createHash("sha256")
      .update(authorization)
      .digest("hex")
      .slice(0, 32);
    dimensions.push(`cred:${credentialHash}`);
  }
  return dimensions;
}

/**
 * In-memory per-IP rate limiter for sensitive endpoints.
 * Falls back gracefully — if Redis is available via app.redis,
 * the global @fastify/rate-limit plugin already provides distributed limiting.
 * This adds an additional layer specifically for auth-adjacent routes.
 */
function authRateLimitPlugin(app: FastifyInstance, _opts: unknown, done: () => void) {
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent memory growth
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, AUTH_RATE_LIMIT_WINDOW_MS * 2);

  // Clear interval when server closes
  app.addHook("onClose", async () => {
    clearInterval(cleanupInterval);
  });

  app.addHook("onRequest", async (request, reply) => {
    const isSensitive = SENSITIVE_PREFIXES.some((prefix) => request.url.startsWith(prefix));
    if (!isSensitive) return;

    const now = Date.now();
    const dimensions = rateLimitDimensions(request);

    // Track the most-consumed bucket across all dimensions; the request is
    // throttled if ANY dimension exceeds the limit.
    let highestCount = 0;
    let trippedRetryAfterSec = 0;

    // Try Redis-backed rate limiting if available
    if (app.redis) {
      try {
        for (const dimension of dimensions) {
          const redisKey = `auth-rl:${dimension}`;
          const count = await app.redis.incr(redisKey);
          if (count === 1) {
            await app.redis.pexpire(redisKey, AUTH_RATE_LIMIT_WINDOW_MS);
          }
          if (count > highestCount) highestCount = count;
          if (count > AUTH_RATE_LIMIT_MAX && trippedRetryAfterSec === 0) {
            const ttl = await app.redis.pttl(redisKey);
            trippedRetryAfterSec = Math.ceil(Math.max(ttl, 0) / 1000);
          }
        }

        reply.header("X-RateLimit-Limit", AUTH_RATE_LIMIT_MAX);
        reply.header("X-RateLimit-Remaining", Math.max(0, AUTH_RATE_LIMIT_MAX - highestCount));

        if (highestCount > AUTH_RATE_LIMIT_MAX) {
          return reply.code(429).send({
            error: "Too many requests",
            statusCode: 429,
            retryAfter: trippedRetryAfterSec,
          });
        }
        return;
      } catch {
        // Redis failed — fall through to in-memory
      }
    }

    // In-memory fallback
    let trippedResetAt = now + AUTH_RATE_LIMIT_WINDOW_MS;
    for (const dimension of dimensions) {
      const key = `auth-rl:${dimension}`;
      let entry = store.get(key);
      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS };
        store.set(key, entry);
      }
      entry.count++;
      if (entry.count > highestCount) {
        highestCount = entry.count;
        trippedResetAt = entry.resetAt;
      }
    }

    reply.header("X-RateLimit-Limit", AUTH_RATE_LIMIT_MAX);
    reply.header("X-RateLimit-Remaining", Math.max(0, AUTH_RATE_LIMIT_MAX - highestCount));
    reply.header("X-RateLimit-Reset", Math.ceil(trippedResetAt / 1000));

    if (highestCount > AUTH_RATE_LIMIT_MAX) {
      return reply.code(429).send({
        error: "Too many requests",
        statusCode: 429,
        retryAfter: Math.ceil((trippedResetAt - now) / 1000),
      });
    }
  });

  done();
}

export const authRateLimit = fp(authRateLimitPlugin, {
  name: "auth-rate-limit",
  fastify: "5.x",
});
