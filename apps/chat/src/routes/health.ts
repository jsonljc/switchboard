import type { FastifyPluginAsync } from "fastify";

interface PrismaLike {
  $queryRaw: (q: TemplateStringsArray) => Promise<unknown>;
}

interface RedisLike {
  ping: () => Promise<string>;
}

export interface ChatHealthRoutesOptions {
  prisma: PrismaLike | null;
  redis: RedisLike | null;
  apiBaseUrl: string | null;
  internalApiSecret: string | null;
  fetchImpl?: typeof fetch;
}

interface CheckResult {
  status: "connected" | "disconnected" | "not_configured";
  latencyMs: number;
  error?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function sanitizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const chatHealthRoutes: FastifyPluginAsync<ChatHealthRoutesOptions> = async (app, opts) => {
  const fetcher = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  // GET /deep — Deep readiness check for chat: DB, Redis, and api reachability.
  app.get("/deep", async (_request, reply) => {
    const checks: Record<string, CheckResult> = {};
    let healthy = true;

    // DB
    const dbStart = Date.now();
    if (opts.prisma) {
      try {
        await withTimeout(opts.prisma.$queryRaw`SELECT 1`, 3000);
        checks["database"] = { status: "connected", latencyMs: Date.now() - dbStart };
      } catch (err) {
        checks["database"] = {
          status: "disconnected",
          latencyMs: Date.now() - dbStart,
          error: sanitizeError(err),
        };
        healthy = false;
      }
    } else {
      checks["database"] = { status: "not_configured", latencyMs: 0 };
    }

    // Redis
    const redisStart = Date.now();
    if (opts.redis) {
      try {
        await withTimeout(opts.redis.ping(), 3000);
        checks["redis"] = { status: "connected", latencyMs: Date.now() - redisStart };
      } catch (err) {
        checks["redis"] = {
          status: "disconnected",
          latencyMs: Date.now() - redisStart,
          error: sanitizeError(err),
        };
        healthy = false;
      }
    } else {
      checks["redis"] = { status: "not_configured", latencyMs: 0 };
    }

    // api reachability — skipped (not a failure) when SWITCHBOARD_API_URL is unset
    const apiStart = Date.now();
    if (opts.apiBaseUrl && opts.internalApiSecret) {
      try {
        const res = await withTimeout(
          fetcher(`${opts.apiBaseUrl}/health`, {
            method: "GET",
            headers: { "x-internal-api-secret": opts.internalApiSecret },
          }),
          3000,
        );
        if (res.ok) {
          checks["api"] = { status: "connected", latencyMs: Date.now() - apiStart };
        } else {
          checks["api"] = {
            status: "disconnected",
            latencyMs: Date.now() - apiStart,
            error: `HTTP ${res.status}`,
          };
          healthy = false;
        }
      } catch (err) {
        checks["api"] = {
          status: "disconnected",
          latencyMs: Date.now() - apiStart,
          error: sanitizeError(err),
        };
        healthy = false;
      }
    } else {
      checks["api"] = { status: "not_configured", latencyMs: 0 };
    }

    return reply.code(healthy ? 200 : 503).send({
      healthy,
      checks,
      checkedAt: new Date().toISOString(),
    });
  });
};
