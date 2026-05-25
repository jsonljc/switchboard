import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authMiddleware } from "../auth.js";

// AU-3 (Cat 1.10): dashboard-generated API keys are validated against the DB
// and cached in-process. A 60s cache TTL meant a revoked/rotated key kept
// authenticating for up to 60s. The TTL must be short and configurable so
// revocation takes effect promptly.

interface MockPrisma {
  dashboardUser: { findUnique: ReturnType<typeof vi.fn> };
}

async function buildApp(prisma: MockPrisma): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("prisma", prisma as never);
  await app.register(authMiddleware);
  app.get("/api/protected", async () => ({ ok: true }));
  await app.ready();
  return app;
}

const KEY = "Bearer dashboard-secret-key";

describe("auth DB key cache revocation", () => {
  let savedKeys: string | undefined;
  let savedTtl: string | undefined;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedKeys = process.env["API_KEYS"];
    savedTtl = process.env["DB_KEY_CACHE_TTL_MS"];
    savedEnv = process.env["NODE_ENV"];
    // No static keys — force the DB-key fallback path.
    process.env["API_KEYS"] = "";
    process.env["NODE_ENV"] = "test";
  });

  afterEach(() => {
    process.env["API_KEYS"] = savedKeys;
    if (savedTtl === undefined) delete process.env["DB_KEY_CACHE_TTL_MS"];
    else process.env["DB_KEY_CACHE_TTL_MS"] = savedTtl;
    process.env["NODE_ENV"] = savedEnv;
  });

  it("rejects a revoked key once the cache entry expires", async () => {
    // TTL 0 = always re-validate against the DB on the auth path.
    process.env["DB_KEY_CACHE_TTL_MS"] = "0";
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ organizationId: "org-1", principalId: "p-1" })
      .mockResolvedValue(null); // key revoked from here on
    const app = await buildApp({ dashboardUser: { findUnique } });

    const first = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: KEY },
    });
    expect(first.statusCode).toBe(200);

    // Key has been revoked (findUnique now returns null). With a non-stale
    // cache the next request must re-hit the DB and be rejected.
    const second = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: KEY },
    });
    expect(second.statusCode).toBe(401);
    expect(findUnique).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it("still caches a valid key within the TTL window (no DB hit per request)", async () => {
    process.env["DB_KEY_CACHE_TTL_MS"] = "60000";
    const findUnique = vi.fn().mockResolvedValue({ organizationId: "org-1", principalId: "p-1" });
    const app = await buildApp({ dashboardUser: { findUnique } });

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/api/protected",
        headers: { authorization: KEY },
      });
      expect(res.statusCode).toBe(200);
    }
    // Cache hit on requests 2 and 3 — DB queried only once.
    expect(findUnique).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("defaults to a short TTL well under the previous 60s window", async () => {
    delete process.env["DB_KEY_CACHE_TTL_MS"];
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ organizationId: "org-1", principalId: "p-1" })
      .mockResolvedValue(null);
    const app = await buildApp({ dashboardUser: { findUnique } });

    const first = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { authorization: KEY },
    });
    expect(first.statusCode).toBe(200);

    // Advance time past the new default TTL but well under the old 60s.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);
    try {
      const second = await app.inject({
        method: "GET",
        url: "/api/protected",
        headers: { authorization: KEY },
      });
      expect(second.statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }

    await app.close();
  });
});
