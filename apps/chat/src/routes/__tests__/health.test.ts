import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { chatHealthRoutes } from "../health.js";

const DEEP_TIMEOUT_MS = 3000; // matches withTimeout call sites in health.ts

type PrismaLike = { $queryRaw: ReturnType<typeof vi.fn> };
type RedisLike = { ping: ReturnType<typeof vi.fn> };

function buildApp(opts: {
  prisma?: PrismaLike | null;
  redis?: RedisLike | null;
  apiBaseUrl?: string | null;
  internalApiSecret?: string | null;
  fetchImpl?: typeof fetch;
}): FastifyInstance {
  const app = Fastify();
  app.register(chatHealthRoutes, {
    prefix: "/api/health",
    prisma: opts.prisma ?? null,
    redis: opts.redis ?? null,
    apiBaseUrl: opts.apiBaseUrl ?? null,
    internalApiSecret: opts.internalApiSecret ?? null,
    fetchImpl: opts.fetchImpl,
  });
  return app;
}

describe("chat /api/health/deep", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  it("returns 200 healthy when all checks pass", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(true);
    expect(body.checks["database"]?.status).toBe("connected");
    expect(body.checks["redis"]?.status).toBe("connected");
    expect(body.checks["api"]?.status).toBe("connected");
  });

  it("returns 503 when database is unreachable", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(false);
    expect(body.checks["database"]?.status).toBe("disconnected");
  });

  it("marks api check as skipped when SWITCHBOARD_API_URL is unset (does NOT 503 — cascading-failures safe)", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: null,
      internalApiSecret: null,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(true);
    expect(body.checks["api"]?.status).toBe("not_configured");
  });

  it("returns 503 when redis is unreachable", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(503);
    const body = res.json() as {
      healthy: boolean;
      checks: Record<string, { status: string; error?: string }>;
    };
    expect(body.healthy).toBe(false);
    expect(body.checks["redis"]?.status).toBe("disconnected");
    // safeErrorTag whitelist: returns name (+ optional code), never err.message.
    expect(body.checks["redis"]?.error).toBe("Error");
  });

  it("never returns raw err.message in the error tag (prevents leaking connection strings)", async () => {
    const leakyMessage =
      "Can't reach database server at postgresql://user:hunter2@10.0.0.5:5432/db";
    const err = new Error(leakyMessage);
    err.name = "PrismaClientInitializationError";
    (err as { code?: string }).code = "P1001";

    const prisma: PrismaLike = { $queryRaw: vi.fn().mockRejectedValue(err) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };

    app = buildApp({ prisma, redis });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });
    const body = res.json() as { checks: Record<string, { error?: string }> };

    expect(body.checks["database"]?.error).toBe("PrismaClientInitializationError:P1001");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });

  it("times out a hanging dependency and reports disconnected (withTimeout fires)", async () => {
    // Never-resolving promise — only the withTimeout setTimeout can settle the race.
    const hangForever = new Promise<unknown>(() => {});
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockReturnValue(hangForever) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };

    app = buildApp({ prisma, redis });

    vi.useFakeTimers();
    try {
      const pending = app.inject({ method: "GET", url: "/api/health/deep" });
      await vi.advanceTimersByTimeAsync(DEEP_TIMEOUT_MS + 100);
      const res = await pending;

      expect(res.statusCode).toBe(503);
      const body = res.json() as { checks: Record<string, { status: string; error?: string }> };
      expect(body.checks["database"]?.status).toBe("disconnected");
      expect(body.checks["database"]?.error).toBe("Error"); // new Error("timeout").name
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 503 when api is reachable but returns 5xx", async () => {
    const prisma: PrismaLike = { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) };
    const redis: RedisLike = { ping: vi.fn().mockResolvedValue("PONG") };
    const fetchImpl = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }));

    app = buildApp({
      prisma,
      redis,
      apiBaseUrl: "https://api.example.test",
      internalApiSecret: "test-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await app.inject({ method: "GET", url: "/api/health/deep" });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { healthy: boolean; checks: Record<string, { status: string }> };
    expect(body.healthy).toBe(false);
    expect(body.checks["api"]?.status).toBe("disconnected");
  });
});
