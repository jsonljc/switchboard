import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authRateLimit } from "../rate-limit.js";

// AU-4 (Cat 1.11): the auth rate limiter must throttle on a per-credential
// dimension in addition to per-IP, so an attacker rotating source IPs while
// reusing one stolen API key cannot bypass the limit.
async function buildApp(): Promise<FastifyInstance> {
  // trustProxy lets the tests vary request.ip via X-Forwarded-For.
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(authRateLimit);
  app.post("/api/auth/login", async () => ({ ok: true }));
  app.post("/api/public/ping", async () => ({ ok: true }));
  return app;
}

const AUTH_MAX = 5;

describe("authRateLimit per-credential dimension", () => {
  it("throttles a single credential even across rotating source IPs", async () => {
    const app = await buildApp();
    const token = "Bearer stolen-key-abc";

    // 5 requests, each from a DISTINCT IP, all carrying the same credential.
    // Per-IP-only limiting would let every one through (fresh IP bucket each
    // time). The per-credential bucket must cap them at AUTH_MAX.
    for (let i = 0; i < AUTH_MAX; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { authorization: token, "x-forwarded-for": `10.0.0.${i}` },
        payload: {},
      });
      expect(res.statusCode, `request ${i + 1} from a fresh IP should pass`).toBe(200);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { authorization: token, "x-forwarded-for": "10.0.0.99" },
      payload: {},
    });
    expect(limited.statusCode).toBe(429);

    await app.close();
  });

  it("keeps distinct credentials in independent buckets", async () => {
    const app = await buildApp();

    // Exhaust credential A from a single IP.
    for (let i = 0; i < AUTH_MAX; i++) {
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { authorization: "Bearer key-A", "x-forwarded-for": "10.1.0.1" },
        payload: {},
      });
    }
    const aLimited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { authorization: "Bearer key-A", "x-forwarded-for": "10.1.0.1" },
      payload: {},
    });
    expect(aLimited.statusCode).toBe(429);

    // Credential B from the SAME IP — IP bucket is now over A's count, so this
    // proves credential B is tracked independently and not blocked by A.
    const bOk = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { authorization: "Bearer key-B", "x-forwarded-for": "10.1.0.99" },
      payload: {},
    });
    expect(bOk.statusCode).toBe(200);

    await app.close();
  });

  it("still throttles per-IP when no credential is presented", async () => {
    const app = await buildApp();

    for (let i = 0; i < AUTH_MAX; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": "10.2.0.1" },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-for": "10.2.0.1" },
      payload: {},
    });
    expect(limited.statusCode).toBe(429);

    await app.close();
  });

  it("ignores non-sensitive routes", async () => {
    const app = await buildApp();

    for (let i = 0; i < AUTH_MAX + 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/public/ping",
        headers: { "x-forwarded-for": "10.3.0.1" },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    }

    await app.close();
  });
});
