import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { healthRoutes } from "../routes/health.js";

describe("Health API", () => {
  let app: FastifyInstance;

  const mockCartridges = {
    list: vi.fn(),
    get: vi.fn(),
  };

  const mockAuditLedger = {
    record: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("redis", null);
    app.decorate("executionQueue", null);
    app.decorate("executionWorker", null);
    app.decorate("storageContext", { cartridges: mockCartridges } as any);
    app.decorate("auditLedger", mockAuditLedger as any);

    await app.register(healthRoutes, { prefix: "/api/health" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/health/deep", () => {
    it("returns healthy when all systems are up", async () => {
      mockCartridges.list.mockReturnValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.healthy).toBe(true);
      expect(body.checks.database).toBeDefined();
      expect(body.checks.redis).toBeDefined();
    });

    it("reports redis as not configured when null", async () => {
      mockCartridges.list.mockReturnValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checks.redis.status).toBe("not_configured");
    });

    it("reports redis as connected when ping succeeds", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("redis", { ping: vi.fn().mockResolvedValue("PONG") } as any);
      app.decorate("executionQueue", null);
      app.decorate("executionWorker", null);
      app.decorate("storageContext", { cartridges: mockCartridges } as any);
      app.decorate("auditLedger", mockAuditLedger as any);
      await app.register(healthRoutes, { prefix: "/api/health" });

      mockCartridges.list.mockReturnValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().checks.redis.status).toBe("connected");
    });

    it("reports queue depth when execution queue is available", async () => {
      await app.close();

      const mockQueue = {
        getWaitingCount: vi.fn().mockResolvedValue(5),
        getActiveCount: vi.fn().mockResolvedValue(2),
        getDelayedCount: vi.fn().mockResolvedValue(1),
        getFailedCount: vi.fn().mockResolvedValue(0),
      };

      app = Fastify({ logger: false });
      app.decorate("redis", null);
      app.decorate("executionQueue", mockQueue as any);
      app.decorate("executionWorker", null);
      app.decorate("storageContext", { cartridges: mockCartridges } as any);
      app.decorate("auditLedger", mockAuditLedger as any);
      await app.register(healthRoutes, { prefix: "/api/health" });

      mockCartridges.list.mockReturnValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checks.queue.status).toBe("connected");
      expect(body.checks.queue.detail.waiting).toBe(5);
    });

    it("reports worker status", async () => {
      await app.close();

      const mockWorker = {
        isRunning: vi.fn().mockReturnValue(true),
        isPaused: vi.fn().mockReturnValue(false),
      };

      app = Fastify({ logger: false });
      app.decorate("redis", null);
      app.decorate("executionQueue", null);
      app.decorate("executionWorker", mockWorker as any);
      app.decorate("storageContext", { cartridges: mockCartridges } as any);
      app.decorate("auditLedger", mockAuditLedger as any);
      await app.register(healthRoutes, { prefix: "/api/health" });

      mockCartridges.list.mockReturnValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checks.worker.status).toBe("running");
    });

    it("reports cartridge health", async () => {
      mockCartridges.list.mockReturnValue(["digital-ads"]);
      mockCartridges.get.mockReturnValue({
        healthCheck: vi.fn().mockResolvedValue({ status: "connected", latencyMs: 42 }),
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checks.cartridges.detail["digital-ads"].status).toBe("connected");
    });

    it("returns 503 when a cartridge is disconnected", async () => {
      mockCartridges.list.mockReturnValue(["broken-cartridge"]);
      mockCartridges.get.mockReturnValue({
        healthCheck: vi.fn().mockRejectedValue(new Error("Connection timeout")),
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/health/deep",
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().healthy).toBe(false);
    });
  });

  describe("GET /api/health/cartridges", () => {
    it("returns cartridge health results", async () => {
      mockCartridges.list.mockReturnValue(["digital-ads"]);
      mockCartridges.get.mockReturnValue({
        healthCheck: vi.fn().mockResolvedValue({
          status: "connected",
          latencyMs: 15,
          error: null,
          capabilities: ["execute", "diagnose"],
        }),
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/health/cartridges",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.healthy).toBe(true);
      expect(body.cartridges).toHaveLength(1);
      expect(body.cartridges[0].status).toBe("connected");
    });

    it("returns 503 for disconnected cartridge and records audit", async () => {
      mockCartridges.list.mockReturnValue(["broken"]);
      mockCartridges.get.mockReturnValue({
        healthCheck: vi.fn().mockResolvedValue({
          status: "disconnected",
          latencyMs: 0,
          error: "Failed",
          capabilities: [],
        }),
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/health/cartridges",
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().healthy).toBe(false);
      expect(mockAuditLedger.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "connection.degraded",
          entityId: "broken",
        }),
      );
    });
  });
});
