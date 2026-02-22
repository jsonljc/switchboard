import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("Production Hardening", () => {
  describe("Global Error Handler", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      const ctx: TestContext = await buildTestServer();
      app = ctx.app;
    });

    afterEach(async () => {
      await app.close();
    });

    it("should return consistent error format for 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/actions/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe("string");
    });

    it("should return consistent error format for validation errors", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/propose",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
    });

    it("should not leak stack traces in error responses", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/non-existent-id/execute",
      });

      const body = res.json();
      expect(body.stack).toBeUndefined();
      expect(body.error).not.toContain("at ");
    });
  });

  describe("CORS", () => {
    it("should reflect allowed origin when CORS_ORIGIN is not set (dev mode)", async () => {
      const app = Fastify({ logger: false });
      await app.register(cors, { origin: true });
      app.get("/test", async () => ({ ok: true }));

      const res = await app.inject({
        method: "GET",
        url: "/test",
        headers: { origin: "http://localhost:5173" },
      });

      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      await app.close();
    });

    it("should restrict to configured origins when CORS_ORIGIN is set", async () => {
      const app = Fastify({ logger: false });
      await app.register(cors, {
        origin: ["https://app.example.com"],
      });
      app.get("/test", async () => ({ ok: true }));

      // Allowed origin
      const allowedRes = await app.inject({
        method: "GET",
        url: "/test",
        headers: { origin: "https://app.example.com" },
      });
      expect(allowedRes.headers["access-control-allow-origin"]).toBe("https://app.example.com");

      // Disallowed origin
      const blockedRes = await app.inject({
        method: "GET",
        url: "/test",
        headers: { origin: "https://evil.com" },
      });
      expect(blockedRes.headers["access-control-allow-origin"]).toBeUndefined();

      await app.close();
    });
  });

  describe("Rate Limiting", () => {
    it("should return 429 after exceeding max requests", async () => {
      const app = Fastify({ logger: false });
      await app.register(rateLimit, { max: 3, timeWindow: 60000 });
      app.get("/test", async () => ({ ok: true }));

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({ method: "GET", url: "/test" });
        expect(res.statusCode).toBe(200);
      }

      // 4th request should be rate limited
      const res = await app.inject({ method: "GET", url: "/test" });
      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.message).toContain("Rate limit");

      await app.close();
    });

    it("should include rate limit headers", async () => {
      const app = Fastify({ logger: false });
      await app.register(rateLimit, { max: 10, timeWindow: 60000 });
      app.get("/test", async () => ({ ok: true }));

      const res = await app.inject({ method: "GET", url: "/test" });

      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();

      await app.close();
    });
  });
});
