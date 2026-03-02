import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { governanceRoutes } from "../routes/governance.js";

describe("Governance API", () => {
  let app: FastifyInstance;

  const mockGovernanceProfileStore = {
    get: vi.fn(),
    set: vi.fn(),
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  };

  const mockCartridges = {
    get: vi.fn(),
  };

  const mockOrchestrator = {
    propose: vi.fn(),
    executeApproved: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("governanceProfileStore", mockGovernanceProfileStore);
    app.decorate("storageContext", { cartridges: mockCartridges });
    app.decorate("orchestrator", mockOrchestrator);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.decorateRequest("principalIdFromAuth", undefined);

    await app.register(governanceRoutes, { prefix: "/api/governance" });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/governance/:orgId/status ──────────────────────────────

  describe("GET /api/governance/:orgId/status", () => {
    it("returns profile, posture, and config", async () => {
      mockGovernanceProfileStore.get.mockResolvedValue("guarded");
      mockGovernanceProfileStore.getConfig.mockResolvedValue({
        approvalTimeout: 3600,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/governance/org_123/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.organizationId).toBe("org_123");
      expect(body.profile).toBe("guarded");
      // profileToPosture("guarded") => "normal"
      expect(body.posture).toBe("normal");
      expect(body.config).toEqual({ approvalTimeout: 3600 });

      expect(mockGovernanceProfileStore.get).toHaveBeenCalledWith("org_123");
      expect(mockGovernanceProfileStore.getConfig).toHaveBeenCalledWith("org_123");
    });

    it("returns correct posture for strict profile", async () => {
      mockGovernanceProfileStore.get.mockResolvedValue("strict");
      mockGovernanceProfileStore.getConfig.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/governance/org_456/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profile).toBe("strict");
      // profileToPosture("strict") => "elevated"
      expect(body.posture).toBe("elevated");
    });

    it("returns correct posture for locked profile", async () => {
      mockGovernanceProfileStore.get.mockResolvedValue("locked");
      mockGovernanceProfileStore.getConfig.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/governance/org_789/status",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profile).toBe("locked");
      // profileToPosture("locked") => "critical"
      expect(body.posture).toBe("critical");
    });
  });

  // ── PUT /api/governance/:orgId/profile ─────────────────────────────

  describe("PUT /api/governance/:orgId/profile", () => {
    it("sets profile and returns updated profile with posture", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "PUT",
        url: "/api/governance/org_123/profile",
        payload: { profile: "strict" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.organizationId).toBe("org_123");
      expect(body.profile).toBe("strict");
      expect(body.posture).toBe("elevated");

      expect(mockGovernanceProfileStore.set).toHaveBeenCalledWith("org_123", "strict");
    });

    it("returns 400 when profile is missing", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/governance/org_123/profile",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("profile is required");
    });

    it("returns 400 for invalid profile value", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/governance/org_123/profile",
        payload: { profile: "banana" },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("Invalid profile");
      expect(body.error).toContain("banana");
    });

    it("accepts all valid profile values", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);

      for (const profile of ["observe", "guarded", "strict", "locked"]) {
        const res = await app.inject({
          method: "PUT",
          url: "/api/governance/org_123/profile",
          payload: { profile },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().profile).toBe(profile);
      }
    });
  });

  // ── POST /api/governance/emergency-halt ────────────────────────────

  describe("POST /api/governance/emergency-halt", () => {
    it("locks profile and pauses active campaigns", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);

      const mockCartridge = {
        searchCampaigns: vi.fn().mockResolvedValue([
          { id: "camp_1", status: "ACTIVE" },
          { id: "camp_2", status: "PAUSED" },
          { id: "camp_3", status: "ACTIVE" },
        ]),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      mockOrchestrator.propose.mockResolvedValue({
        denied: false,
        envelope: { id: "env_1" },
      });
      mockOrchestrator.executeApproved.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: {
          organizationId: "org_123",
          reason: "Security incident",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.governanceProfile).toBe("locked");
      expect(body.organizationId).toBe("org_123");
      // Only ACTIVE campaigns are paused (camp_1 and camp_3)
      expect(body.campaignsPaused).toEqual(["camp_1", "camp_3"]);
      expect(body.failures).toEqual([]);
      expect(body.reason).toBe("Security incident");

      expect(mockGovernanceProfileStore.set).toHaveBeenCalledWith("org_123", "locked");
    });

    it("reports failures when campaign pause throws", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);

      const mockCartridge = {
        searchCampaigns: vi.fn().mockResolvedValue([
          { id: "camp_fail", status: "ACTIVE" },
        ]),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      mockOrchestrator.propose.mockRejectedValue(new Error("Orchestrator down"));

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.governanceProfile).toBe("locked");
      expect(body.campaignsPaused).toEqual([]);
      expect(body.failures).toHaveLength(1);
      expect(body.failures[0].campaignId).toBe("camp_fail");
      expect(body.failures[0].error).toBe("Orchestrator down");
    });

    it("succeeds even when cartridge is unavailable", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);
      mockCartridges.get.mockReturnValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.governanceProfile).toBe("locked");
      expect(body.campaignsPaused).toEqual([]);
      expect(body.failures).toEqual([]);
    });

    it("does not pause denied proposals", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);

      const mockCartridge = {
        searchCampaigns: vi.fn().mockResolvedValue([
          { id: "camp_denied", status: "ACTIVE" },
        ]),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      mockOrchestrator.propose.mockResolvedValue({
        denied: true,
        envelope: { id: "env_denied" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaignsPaused).toEqual([]);
      expect(mockOrchestrator.executeApproved).not.toHaveBeenCalled();
    });

    it("defaults reason to null when not provided", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);
      mockCartridges.get.mockReturnValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().reason).toBeNull();
    });
  });
});
