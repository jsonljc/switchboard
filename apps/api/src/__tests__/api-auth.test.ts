import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { authMiddleware } from "../middleware/auth.js";

describe("Auth Middleware", () => {
  describe("when API_KEYS is set", () => {
    const originalEnv = process.env["API_KEYS"];

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env["API_KEYS"];
      } else {
        process.env["API_KEYS"] = originalEnv;
      }
    });

    async function buildApp(keys: string) {
      process.env["API_KEYS"] = keys;
      const app = Fastify({ logger: false });
      await app.register(authMiddleware);
      app.get("/health", async () => ({ status: "ok" }));
      app.get("/docs", async () => ({ docs: true }));
      app.get("/docs/json", async () => ({ spec: true }));
      app.get("/api/test", async () => ({ data: "secret" }));
      app.post("/api/actions/propose", async () => ({ ok: true }));
      return app;
    }

    it("should return 401 when no Authorization header is provided", async () => {
      const app = await buildApp("test-key-1,test-key-2");
      const res = await app.inject({ method: "GET", url: "/api/test" });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Missing Authorization header");
      await app.close();
    });

    it("should return 401 for invalid Authorization format", async () => {
      const app = await buildApp("test-key-1");
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: { authorization: "Basic abc123" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid Authorization format");
      await app.close();
    });

    it("should return 401 for invalid API key", async () => {
      const app = await buildApp("test-key-1");
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: { authorization: "Bearer wrong-key" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("Invalid API key");
      await app.close();
    });

    it("should allow request with valid API key", async () => {
      const app = await buildApp("test-key-1,test-key-2");
      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: { authorization: "Bearer test-key-2" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBe("secret");
      await app.close();
    });

    it("should skip auth for /health", async () => {
      const app = await buildApp("test-key-1");
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ok");
      await app.close();
    });

    it("should skip auth for /docs", async () => {
      const app = await buildApp("test-key-1");
      const res = await app.inject({ method: "GET", url: "/docs" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it("should skip auth for /docs/json", async () => {
      const app = await buildApp("test-key-1");
      const res = await app.inject({ method: "GET", url: "/docs/json" });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("when API_KEYS is not set (development mode)", () => {
    it("should allow all requests without authentication", async () => {
      const original = process.env["API_KEYS"];
      delete process.env["API_KEYS"];

      const app = Fastify({ logger: false });
      await app.register(authMiddleware);
      app.get("/api/test", async () => ({ data: "open" }));

      const res = await app.inject({ method: "GET", url: "/api/test" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBe("open");

      await app.close();

      if (original !== undefined) {
        process.env["API_KEYS"] = original;
      }
    });
  });
});
