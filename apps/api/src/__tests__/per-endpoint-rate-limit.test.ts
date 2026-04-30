import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

// Verifies the @fastify/rate-limit per-route override mechanism that approvals.ts and execute.ts
// rely on. Risk #5 acceptance: "approval endpoints can exceed global limit." We pin the global
// max low (2) and the override high (10), then prove a 3rd request to the default route 429s
// while 5 requests to the override route all succeed in the same window.
describe("Per-endpoint rate-limit override", () => {
  async function buildApp() {
    const app = Fastify({ logger: false });
    await app.register(rateLimit, { max: 2, timeWindow: 60_000 });

    // Default route — inherits global max:2
    app.post("/api/healthz", async () => ({ ok: true }));

    // Override route — mirrors what approvals.ts / execute.ts do
    app.post(
      "/api/approvals/:id/respond",
      {
        config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      },
      async () => ({ ok: true }),
    );

    return app;
  }

  it("allows the override route to exceed the global limit in the same window", async () => {
    const app = await buildApp();

    // 5 requests to the override route, all within the global window — must all succeed
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/approvals/abc/respond",
        payload: {},
      });
      expect(res.statusCode, `override request ${i + 1} should succeed`).toBe(200);
    }

    await app.close();
  });

  it("still rate-limits the default route at the global limit", async () => {
    const app = await buildApp();

    // First 2 succeed
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: "/api/healthz", payload: {} });
      expect(res.statusCode).toBe(200);
    }

    // 3rd 429s
    const limited = await app.inject({ method: "POST", url: "/api/healthz", payload: {} });
    expect(limited.statusCode).toBe(429);

    await app.close();
  });

  it("tracks override and default windows independently", async () => {
    const app = await buildApp();

    // Exhaust default route
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: "POST", url: "/api/healthz", payload: {} });
    }
    const defaultLimited = await app.inject({
      method: "POST",
      url: "/api/healthz",
      payload: {},
    });
    expect(defaultLimited.statusCode).toBe(429);

    // Override route still works — separate window
    const overrideOk = await app.inject({
      method: "POST",
      url: "/api/approvals/abc/respond",
      payload: {},
    });
    expect(overrideOk.statusCode).toBe(200);

    await app.close();
  });
});
