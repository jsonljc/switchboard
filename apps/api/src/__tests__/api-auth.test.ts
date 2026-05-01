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

      // authDisabled flag must be set so org-access helpers know it's dev mode.
      expect(app.authDisabled).toBe(true);

      await app.close();

      if (original !== undefined) {
        process.env["API_KEYS"] = original;
      }
    });
  });

  describe("production hardening — unscoped static keys", () => {
    const originalKeys = process.env["API_KEYS"];
    const originalMeta = process.env["API_KEY_METADATA"];
    const originalNodeEnv = process.env["NODE_ENV"];

    afterEach(() => {
      if (originalKeys === undefined) {
        delete process.env["API_KEYS"];
      } else {
        process.env["API_KEYS"] = originalKeys;
      }
      if (originalMeta === undefined) {
        delete process.env["API_KEY_METADATA"];
      } else {
        process.env["API_KEY_METADATA"] = originalMeta;
      }
      if (originalNodeEnv === undefined) {
        delete process.env["NODE_ENV"];
      } else {
        process.env["NODE_ENV"] = originalNodeEnv;
      }
    });

    it("refuses to start when API_KEYS lacks API_KEY_METADATA in production", async () => {
      process.env["API_KEYS"] = "unscoped-key";
      delete process.env["API_KEY_METADATA"];
      process.env["NODE_ENV"] = "production";

      const app = Fastify({ logger: false });
      await expect(app.register(authMiddleware)).rejects.toThrow(/Refusing to start/);
      await app.close();
    });

    it("starts but logs a warning when API_KEYS lacks metadata in non-production", async () => {
      process.env["API_KEYS"] = "unscoped-key";
      delete process.env["API_KEY_METADATA"];
      process.env["NODE_ENV"] = "development";

      const app = Fastify({ logger: false });
      await app.register(authMiddleware);
      app.get("/api/test", async () => ({ data: "ok" }));

      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: { authorization: "Bearer unscoped-key" },
      });
      expect(res.statusCode).toBe(200);
      // Even though the request was accepted, no org binding was set.
      expect(app.authDisabled).toBe(false);
      await app.close();
    });

    it("rejects an unscoped static key with 401 in production at request time", async () => {
      // Belt-and-braces: if a key is hot-reloaded without metadata in production,
      // the per-request guard rejects it even though startup validation already
      // refused that configuration on a fresh boot.
      process.env["API_KEYS"] = "k1";
      process.env["API_KEY_METADATA"] = "k1:org-a::p1";
      process.env["NODE_ENV"] = "development";

      const app = Fastify({ logger: false });
      await app.register(authMiddleware);
      app.get("/api/test", async () => ({ data: "ok" }));

      // Re-pretend production for the per-request guard.
      process.env["NODE_ENV"] = "production";
      // Swap to a key with NO metadata via SIGHUP-style reload.
      process.env["API_KEYS"] = "k2";
      delete process.env["API_KEY_METADATA"];
      process.kill(process.pid, "SIGHUP");
      // Allow the SIGHUP handler to run.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const res = await app.inject({
        method: "GET",
        url: "/api/test",
        headers: { authorization: "Bearer k2" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain("not scoped to an organization");

      await app.close();
    });
  });
});
