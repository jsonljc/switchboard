import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

vi.mock("@switchboard/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    computeTokenCostUSD: vi.fn(() => ({ totalCost: 0.005 })),
    listModelCosts: vi.fn(() => [
      { model: "gpt-4", promptCostPer1k: 0.03, completionCostPer1k: 0.06 },
      { model: "gpt-3.5-turbo", promptCostPer1k: 0.001, completionCostPer1k: 0.002 },
    ]),
  };
});

import { tokenUsageRoutes } from "../routes/token-usage.js";
import { computeTokenCostUSD } from "@switchboard/core";

describe("Token Usage API", () => {
  let app: FastifyInstance;

  const mockPipeline = {
    hgetall: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    exec: vi.fn(),
  };

  const mockRedis = {
    pipeline: vi.fn(() => mockPipeline),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("redis", mockRedis as unknown as never);
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/token-usage", () => {
    it("returns zeros when redis is null", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("redis", null);
      app.decorateRequest("organizationIdFromAuth", undefined);
      app.addHook("onRequest", async (request) => {
        request.organizationIdFromAuth = "org_test";
      });
      await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage.promptTokens).toBe(0);
      expect(body.usage.completionTokens).toBe(0);
      expect(body.usage.totalTokens).toBe(0);
      expect(body.usage.estimatedCostUSD).toBe(0);
      expect(body.period).toBe("daily");
    });

    it("returns aggregated token usage from redis", async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, { prompt: "100", completion: "50" }],
        [null, "5000"],
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage?period=daily",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage.promptTokens).toBe(100);
      expect(body.usage.completionTokens).toBe(50);
      expect(body.usage.totalTokens).toBe(150);
      expect(body.usage.estimatedCostUSD).toBe(0.005);
      expect(body.period).toBe("daily");
      expect(body.orgId).toBe("org_test");
    });

    it("aggregates over 7 days for weekly period", async () => {
      const tokenResults = Array.from({ length: 7 }, () => [
        null,
        { prompt: "10", completion: "5" },
      ]);
      const costResults = Array.from({ length: 7 }, () => [null, "1000"]);
      mockPipeline.exec.mockResolvedValue([...tokenResults, ...costResults]);

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage?period=weekly",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage.promptTokens).toBe(70);
      expect(body.usage.completionTokens).toBe(35);
      expect(body.usage.totalTokens).toBe(105);
      expect(body.period).toBe("weekly");
    });

    it("falls back to computeTokenCostUSD when no cost data in redis", async () => {
      mockPipeline.exec.mockResolvedValue([
        [null, { prompt: "200", completion: "100" }],
        [null, null],
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage?period=daily",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage.promptTokens).toBe(200);
      expect(body.usage.completionTokens).toBe(100);
      expect(computeTokenCostUSD).toHaveBeenCalledWith(200, 100);
    });

    it("returns zeros gracefully on pipeline error", async () => {
      mockPipeline.exec.mockRejectedValue(new Error("Redis connection lost"));

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage.promptTokens).toBe(0);
      expect(body.usage.estimatedCostUSD).toBe(0);
    });
  });

  describe("GET /api/token-usage/trend", () => {
    it("returns daily trend data", async () => {
      const days = 3;
      const tokenResults = Array.from({ length: days }, () => [
        null,
        { prompt: "20", completion: "10" },
      ]);
      const costResults = Array.from({ length: days }, () => [null, "2000"]);
      mockPipeline.exec.mockResolvedValue([...tokenResults, ...costResults]);

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage/trend?days=3",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.trend).toHaveLength(3);
      expect(body.trend[0].promptTokens).toBe(20);
      expect(body.trend[0].completionTokens).toBe(10);
      expect(body.trend[0].totalTokens).toBe(30);
      expect(body.orgId).toBe("org_test");
    });

    it("caps days at 90", async () => {
      const tokenResults = Array.from({ length: 90 }, () => [null, {}]);
      const costResults = Array.from({ length: 90 }, () => [null, null]);
      mockPipeline.exec.mockResolvedValue([...tokenResults, ...costResults]);

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage/trend?days=200",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.trend).toHaveLength(90);
    });

    it("returns empty trend when redis is null", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("redis", null);
      app.decorateRequest("organizationIdFromAuth", undefined);
      app.addHook("onRequest", async (request) => {
        request.organizationIdFromAuth = "org_test";
      });
      await app.register(tokenUsageRoutes, { prefix: "/api/token-usage" });

      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage/trend?days=3",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.trend).toHaveLength(3);
      expect(body.trend[0].promptTokens).toBe(0);
    });
  });

  describe("GET /api/token-usage/models", () => {
    it("returns model cost list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/token-usage/models",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.models).toHaveLength(2);
      expect(body.models[0].model).toBe("gpt-4");
    });
  });
});
