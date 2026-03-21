import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { revenueGrowthRoutes } from "../routes/revenue-growth.js";

vi.mock("../services/system-governed-actions.js", () => ({
  executeGovernedSystemAction: vi.fn(),
}));

import { executeGovernedSystemAction } from "../services/system-governed-actions.js";

describe("Revenue Growth API", () => {
  let app: FastifyInstance;

  const mockCartridges = {
    get: vi.fn(),
  };

  const mockOrchestrator = {};

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("storageContext", { cartridges: mockCartridges } as any);
    app.decorate("orchestrator", mockOrchestrator as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(revenueGrowthRoutes, { prefix: "/api/revenue-growth" });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Auth ──────────────────────────────────────────────────────────

  describe("Auth", () => {
    it("returns 403 when no org scope", async () => {
      // Override the hook to not set org ID
      const noAuthApp = Fastify({ logger: false });
      noAuthApp.decorate("storageContext", { cartridges: mockCartridges } as any);
      noAuthApp.decorate("orchestrator", mockOrchestrator as any);
      noAuthApp.decorateRequest("organizationIdFromAuth", undefined);
      await noAuthApp.register(revenueGrowthRoutes, { prefix: "/api/revenue-growth" });

      const res = await noAuthApp.inject({
        method: "POST",
        url: "/api/revenue-growth/act_123/run",
      });

      expect(res.statusCode).toBe(403);
      await noAuthApp.close();
    });
  });

  // ── Cartridge unavailable ─────────────────────────────────────────

  describe("Cartridge unavailable", () => {
    it("returns 503 when cartridge not registered", async () => {
      mockCartridges.get.mockReturnValue(undefined);

      const res = await app.inject({
        method: "GET",
        url: "/api/revenue-growth/act_123/latest",
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("not available");
    });
  });

  // ── POST /:accountId/run ──────────────────────────────────────────

  describe("POST /:accountId/run", () => {
    it("executes governed diagnostic and returns result", async () => {
      mockCartridges.get.mockReturnValue({});
      vi.mocked(executeGovernedSystemAction).mockResolvedValue({
        outcome: "executed",
        executionResult: {
          success: true,
          summary: "Diagnostic complete",
          data: { cycleId: "cycle_1", dataTier: "FULL" },
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 100,
          undoRecipe: null,
        },
        envelopeId: "env_1",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/revenue-growth/act_123/run",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("executed");
      expect(body.data.cycleId).toBe("cycle_1");
    });

    it("returns pending_approval when governed action requires approval", async () => {
      mockCartridges.get.mockReturnValue({});
      vi.mocked(executeGovernedSystemAction).mockResolvedValue({
        outcome: "pending_approval",
        explanation: "Requires manual approval",
        envelopeId: "env_2",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/revenue-growth/act_123/run",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("pending_approval");
      expect(body.explanation).toBe("Requires manual approval");
    });
  });

  // ── GET /:accountId/latest ────────────────────────────────────────

  describe("GET /:accountId/latest", () => {
    it("returns latest diagnostic result", async () => {
      const mockCartridge = {
        execute: vi.fn().mockResolvedValue({
          data: { cycleId: "cycle_1", primaryConstraint: "CREATIVE" },
          summary: "Latest diagnostic",
        }),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/revenue-growth/act_123/latest",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.cycleId).toBe("cycle_1");
      expect(mockCartridge.execute).toHaveBeenCalledWith(
        "revenue-growth.diagnostic.latest",
        { accountId: "act_123" },
        expect.any(Object),
      );
    });
  });

  // ── GET /:accountId/connectors ────────────────────────────────────

  describe("GET /:accountId/connectors", () => {
    it("returns connector health status", async () => {
      const mockCartridge = {
        execute: vi.fn().mockResolvedValue({
          data: [{ connectorId: "meta-ads", name: "Meta Ads", status: "connected" }],
        }),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/revenue-growth/act_123/connectors",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connectors).toHaveLength(1);
      expect(body.connectors[0].status).toBe("connected");
    });
  });

  // ── GET /:accountId/interventions ─────────────────────────────────

  describe("GET /:accountId/interventions", () => {
    it("returns interventions from latest cycle", async () => {
      const mockCartridge = {
        execute: vi.fn().mockResolvedValue({
          data: {
            interventions: [{ id: "int_1", actionType: "REFRESH_CREATIVE", status: "PROPOSED" }],
          },
        }),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/revenue-growth/act_123/interventions",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.interventions).toHaveLength(1);
      expect(body.interventions[0].actionType).toBe("REFRESH_CREATIVE");
    });
  });

  // ── POST /interventions/:id/approve ───────────────────────────────

  describe("POST /interventions/:id/approve", () => {
    it("approves intervention via governed action", async () => {
      mockCartridges.get.mockReturnValue({});
      vi.mocked(executeGovernedSystemAction).mockResolvedValue({
        outcome: "executed",
        executionResult: {
          success: true,
          summary: "Intervention int_1 approved",
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 10,
          undoRecipe: null,
        },
        envelopeId: "env_3",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/revenue-growth/interventions/int_1/approve",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("executed");
    });
  });

  // ── POST /interventions/:id/defer ─────────────────────────────────

  describe("POST /interventions/:id/defer", () => {
    it("defers intervention with reason", async () => {
      mockCartridges.get.mockReturnValue({});
      vi.mocked(executeGovernedSystemAction).mockResolvedValue({
        outcome: "executed",
        executionResult: {
          success: true,
          summary: "Intervention int_1 deferred: Budget not ready",
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 10,
          undoRecipe: null,
        },
        envelopeId: "env_4",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/revenue-growth/interventions/int_1/defer",
        payload: { reason: "Budget not ready" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.outcome).toBe("executed");
      expect(body.summary).toContain("deferred");
    });
  });

  // ── GET /:accountId/digest ────────────────────────────────────────

  describe("GET /:accountId/digest", () => {
    it("returns weekly digest", async () => {
      const mockCartridge = {
        execute: vi.fn().mockResolvedValue({
          data: {
            id: "digest_1",
            headline: "Creative fatigue is easing",
            summary: "Your constraint shifted...",
          },
          summary: "Weekly digest generated",
        }),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/revenue-growth/act_123/digest",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.digest.headline).toBe("Creative fatigue is easing");
    });
  });
});
