// ---------------------------------------------------------------------------
// Endpoint-specific rate limiting — stricter limits for auth/billing endpoints
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const AUTH_RATE_LIMIT_MAX = 5;
const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

/** Sensitive route prefixes that get stricter rate limits. */
const SENSITIVE_PREFIXES = ["/api/auth", "/api/setup/bootstrap", "/api/billing/checkout"];

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

    const ip = request.ip;
    const key = `auth-rl:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS };
      store.set(key, entry);
    }

    entry.count++;

    reply.header("X-RateLimit-Limit", AUTH_RATE_LIMIT_MAX);
    reply.header("X-RateLimit-Remaining", Math.max(0, AUTH_RATE_LIMIT_MAX - entry.count));
    reply.header("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > AUTH_RATE_LIMIT_MAX) {
      return reply.code(429).send({
        error: "Too many requests",
        statusCode: 429,
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
  });

  done();
}

export const authRateLimit = fp(authRateLimitPlugin, {
  name: "auth-rate-limit",
  fastify: "5.x",
});
