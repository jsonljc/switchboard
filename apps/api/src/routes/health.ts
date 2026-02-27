import type { FastifyPluginAsync } from "fastify";
import { sanitizeHealthError } from "../utils/error-sanitizer.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/health/deep - Full system health check
  app.get("/deep", {
    schema: {
      description: "Deep health check: DB, Redis, cartridges, queue depth.",
      tags: ["Health"],
    },
  }, async (_request, reply) => {
    const checks: Record<string, { status: string; latencyMs: number; error?: string; detail?: unknown }> = {};
    let allHealthy = true;

    // DB check
    const dbStart = Date.now();
    try {
      if (process.env["DATABASE_URL"]) {
        // Reuse Prisma client from storageContext — avoid creating ephemeral connections
        const storageCtx = app.storageContext as unknown as Record<string, unknown>;
        const prismaClient = storageCtx["prisma"] as { $queryRaw: (q: TemplateStringsArray) => Promise<unknown> } | undefined;
        if (prismaClient) {
          await prismaClient.$queryRaw`SELECT 1`;
          checks["database"] = { status: "connected", latencyMs: Date.now() - dbStart };
        } else {
          checks["database"] = { status: "in_memory", latencyMs: 0 };
        }
      } else {
        checks["database"] = { status: "not_configured", latencyMs: 0 };
      }
    } catch (err) {
      checks["database"] = { status: "disconnected", latencyMs: Date.now() - dbStart, error: sanitizeHealthError(err) };
      allHealthy = false;
    }

    // Redis check — reuse shared connection
    const redisStart = Date.now();
    try {
      if (app.redis) {
        await app.redis.ping();
        checks["redis"] = { status: "connected", latencyMs: Date.now() - redisStart };
      } else {
        checks["redis"] = { status: "not_configured", latencyMs: 0 };
      }
    } catch (err) {
      checks["redis"] = { status: "disconnected", latencyMs: Date.now() - redisStart, error: sanitizeHealthError(err) };
      allHealthy = false;
    }

    // Queue depth check — reuse shared queue
    try {
      if (app.executionQueue) {
        const waiting = await app.executionQueue.getWaitingCount();
        const active = await app.executionQueue.getActiveCount();
        const delayed = await app.executionQueue.getDelayedCount();
        const failed = await app.executionQueue.getFailedCount();
        checks["queue"] = {
          status: "connected",
          latencyMs: 0,
          detail: { waiting, active, delayed, failed },
        };
      } else {
        checks["queue"] = { status: "not_configured", latencyMs: 0 };
      }
    } catch (err) {
      checks["queue"] = { status: "error", latencyMs: 0, error: sanitizeHealthError(err) };
    }

    // Worker health check
    try {
      if (app.executionWorker) {
        const workerRunning = app.executionWorker.isRunning();
        const workerPaused = app.executionWorker.isPaused();
        const workerStatus = workerPaused ? "paused" : workerRunning ? "running" : "closed";
        checks["worker"] = {
          status: workerStatus,
          latencyMs: 0,
          detail: { running: workerRunning, paused: workerPaused },
        };
        if (!workerRunning) allHealthy = false;
      } else {
        checks["worker"] = { status: "not_configured", latencyMs: 0 };
      }
    } catch (err) {
      checks["worker"] = { status: "error", latencyMs: 0, error: sanitizeHealthError(err) };
    }

    // Cartridge health
    const cartridgeIds = app.storageContext.cartridges.list();
    const cartridgeResults: Record<string, { status: string; latencyMs: number; error?: string }> = {};
    for (const id of cartridgeIds) {
      const cartridge = app.storageContext.cartridges.get(id);
      if (!cartridge) continue;
      const cStart = Date.now();
      try {
        const h = await cartridge.healthCheck();
        cartridgeResults[id] = { status: h.status, latencyMs: h.latencyMs };
        if (h.status !== "connected") allHealthy = false;
      } catch (err) {
        cartridgeResults[id] = { status: "disconnected", latencyMs: Date.now() - cStart, error: sanitizeHealthError(err) };
        allHealthy = false;
      }
    }
    checks["cartridges"] = { status: allHealthy ? "healthy" : "degraded", latencyMs: 0, detail: cartridgeResults };

    return reply.code(allHealthy ? 200 : 503).send({
      healthy: allHealthy,
      checks,
      checkedAt: new Date().toISOString(),
    });
  });

  // GET /api/health/cartridges - Check health of all registered cartridges
  app.get("/cartridges", {
    schema: {
      description: "Check connection health of all registered cartridges.",
      tags: ["Health"],
    },
  }, async (_request, reply) => {
    const cartridgeIds = app.storageContext.cartridges.list();
    const results: Array<{
      cartridgeId: string;
      status: string;
      latencyMs: number;
      error: string | null;
      capabilities: string[];
    }> = [];

    let allHealthy = true;

    for (const id of cartridgeIds) {
      const cartridge = app.storageContext.cartridges.get(id);
      if (!cartridge) continue;

      try {
        const health = await cartridge.healthCheck();
        results.push({
          cartridgeId: id,
          status: health.status,
          latencyMs: health.latencyMs,
          error: health.error,
          capabilities: health.capabilities,
        });
        if (health.status !== "connected") {
          allHealthy = false;
        }
      } catch (err) {
        results.push({
          cartridgeId: id,
          status: "disconnected",
          latencyMs: -1,
          error: sanitizeHealthError(err),
          capabilities: [],
        });
        allHealthy = false;
      }
    }

    // Record degraded connections in audit
    for (const r of results) {
      if (r.status === "degraded" || r.status === "disconnected") {
        await app.auditLedger.record({
          eventType: "connection.degraded",
          actorType: "system",
          actorId: "health-check",
          entityType: "cartridge",
          entityId: r.cartridgeId,
          riskCategory: r.status === "disconnected" ? "high" : "medium",
          summary: `Cartridge ${r.cartridgeId} is ${r.status}: ${r.error ?? "unknown"}`,
          snapshot: {
            status: r.status,
            latencyMs: r.latencyMs,
            error: r.error,
          },
        });
      }
    }

    return reply.code(allHealthy ? 200 : 503).send({
      healthy: allHealthy,
      cartridges: results,
      checkedAt: new Date().toISOString(),
    });
  });
};
