import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { installErrorHandler } from "../error-handler.js";

describe("installErrorHandler (C2a)", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined)
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    installErrorHandler(app);
    app.get("/boom", async () => {
      throw new Error("synthetic-cause");
    });
    app.get("/bad-input", async () => {
      const err = new Error("bad-input") as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    });
    return app;
  }

  it("in development, 5xx body includes the original error message and stack", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("synthetic-cause");
    expect(body.statusCode).toBe(500);
    expect(typeof body.stack).toBe("string");
    expect(body.stack).toContain("Error: synthetic-cause");
    await app.close();
  });

  it("in production, 5xx body scrubs message and omits stack", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("Internal server error");
    expect(body.statusCode).toBe(500);
    expect(body.stack).toBeUndefined();
    await app.close();
  });

  it("4xx errors keep their message and omit stack in both environments", async () => {
    for (const env of ["production", "development"] as const) {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/bad-input" });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("bad-input");
      expect(body.stack).toBeUndefined();
      await app.close();
    }
  });
});
