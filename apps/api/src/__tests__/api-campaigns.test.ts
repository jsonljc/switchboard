import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { campaignsRoutes } from "../routes/campaigns.js";

describe("Campaigns API", () => {
  let app: FastifyInstance;

  const mockCartridges = {
    get: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("storageContext", { cartridges: mockCartridges } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(campaignsRoutes, { prefix: "/api/campaigns" });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/campaigns/:id ─────────────────────────────────────────

  describe("GET /api/campaigns/:id", () => {
    it("returns campaign when found", async () => {
      const mockCartridge = {
        getCampaign: vi.fn().mockResolvedValue({
          id: "camp_1",
          name: "Test Campaign",
          status: "ACTIVE",
          budget: 1000,
        }),
        searchCampaigns: vi.fn(),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/camp_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaign.id).toBe("camp_1");
      expect(body.campaign.name).toBe("Test Campaign");
      expect(body.campaign.status).toBe("ACTIVE");

      expect(mockCartridge.getCampaign).toHaveBeenCalledWith("camp_1");
    });

    it("returns 503 if cartridge not available", async () => {
      mockCartridges.get.mockReturnValue(undefined);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/camp_1",
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error).toContain("not available");
    });

    it("returns 501 if cartridge is not campaign-capable", async () => {
      // Cartridge exists but doesn't have getCampaign/searchCampaigns methods
      mockCartridges.get.mockReturnValue({ someOtherMethod: vi.fn() });

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/camp_1",
      });

      expect(res.statusCode).toBe(501);
      const body = res.json();
      expect(body.error).toContain("getCampaign not implemented");
    });

    it("returns 404 if campaign not found", async () => {
      const mockCartridge = {
        getCampaign: vi.fn().mockResolvedValue(null),
        searchCampaigns: vi.fn(),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/camp_nonexistent",
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toContain("not found");
    });

    it("returns 500 if getCampaign throws", async () => {
      const mockCartridge = {
        getCampaign: vi.fn().mockRejectedValue(new Error("API timeout")),
        searchCampaigns: vi.fn(),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/camp_1",
      });

      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error).toBe("API timeout");
    });
  });

  // ── GET /api/campaigns/search ──────────────────────────────────────

  describe("GET /api/campaigns/search", () => {
    it("returns campaigns matching query", async () => {
      const mockCartridge = {
        getCampaign: vi.fn(),
        searchCampaigns: vi.fn().mockResolvedValue([
          { id: "camp_1", name: "Summer Sale", status: "ACTIVE" },
          { id: "camp_2", name: "Summer Blast", status: "PAUSED" },
        ]),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search?query=summer",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaigns).toHaveLength(2);
      expect(body.total).toBe(2);

      expect(mockCartridge.searchCampaigns).toHaveBeenCalledWith("summer");
    });

    it("returns 400 if query parameter is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search",
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("query parameter is required");
    });

    it("applies limit parameter", async () => {
      const campaigns = Array.from({ length: 30 }, (_, i) => ({
        id: `camp_${i}`,
        name: `Campaign ${i}`,
        status: "ACTIVE",
      }));

      const mockCartridge = {
        getCampaign: vi.fn(),
        searchCampaigns: vi.fn().mockResolvedValue(campaigns),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search?query=campaign&limit=5",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaigns).toHaveLength(5);
      expect(body.total).toBe(30);
    });

    it("defaults to limit of 20", async () => {
      const campaigns = Array.from({ length: 25 }, (_, i) => ({
        id: `camp_${i}`,
        name: `Campaign ${i}`,
        status: "ACTIVE",
      }));

      const mockCartridge = {
        getCampaign: vi.fn(),
        searchCampaigns: vi.fn().mockResolvedValue(campaigns),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search?query=campaign",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaigns).toHaveLength(20);
      expect(body.total).toBe(25);
    });

    it("returns 503 if cartridge not available", async () => {
      mockCartridges.get.mockReturnValue(undefined);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search?query=summer",
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("not available");
    });

    it("returns 501 if cartridge is not campaign-capable", async () => {
      mockCartridges.get.mockReturnValue({ someMethod: vi.fn() });

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search?query=summer",
      });

      expect(res.statusCode).toBe(501);
      expect(res.json().error).toContain("searchCampaigns not implemented");
    });

    it("returns 500 if searchCampaigns throws", async () => {
      const mockCartridge = {
        getCampaign: vi.fn(),
        searchCampaigns: vi.fn().mockRejectedValue(new Error("Search failed")),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      const res = await app.inject({
        method: "GET",
        url: "/api/campaigns/search?query=summer",
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("Search failed");
    });
  });
});
