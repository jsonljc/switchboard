import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { smbRoutes } from "../routes/smb.js";

describe("SMB API", () => {
  let app: FastifyInstance;

  const mockTierStore = {
    getTier: vi.fn(),
    getSmbConfig: vi.fn(),
    setSmbConfig: vi.fn(),
    upgradeTier: vi.fn(),
  };

  const mockSmbActivityLog = {
    query: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("tierStore", mockTierStore);
    app.decorate("smbActivityLog", mockSmbActivityLog);

    // Default: organizationIdFromAuth matches the org in the URL
    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(smbRoutes, { prefix: "/api/smb" });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/smb/:orgId/activity-log ───────────────────────────────

  describe("GET /api/smb/:orgId/activity-log", () => {
    it("returns activity log entries for SMB org", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      mockSmbActivityLog.query.mockResolvedValue([
        { id: "entry_1", action: "campaign.pause", timestamp: "2024-01-01" },
        { id: "entry_2", action: "budget.adjust", timestamp: "2024-01-02" },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_test/activity-log",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries).toHaveLength(2);

      expect(mockSmbActivityLog.query).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_test",
          limit: 50,
          offset: 0,
        }),
      );
    });

    it("returns 400 for non-SMB organization", async () => {
      mockTierStore.getTier.mockResolvedValue("enterprise");

      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_test/activity-log",
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain("SMB");
    });

    it("returns 403 when org in URL does not match auth org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_different/activity-log",
      });

      // org_test (from auth) !== org_different (from URL)
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Forbidden");
    });

    it("passes query parameters to activity log query", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      mockSmbActivityLog.query.mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_test/activity-log?actorId=user_1&actionType=campaign.pause&limit=10&offset=5",
      });

      expect(res.statusCode).toBe(200);
      expect(mockSmbActivityLog.query).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_test",
          actorId: "user_1",
          actionType: "campaign.pause",
          limit: 10,
          offset: 5,
        }),
      );
    });
  });

  // ── GET /api/smb/:orgId/tier ───────────────────────────────────────

  describe("GET /api/smb/:orgId/tier", () => {
    it("returns tier and smbConfig for SMB org", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      mockTierStore.getSmbConfig.mockResolvedValue({
        tier: "smb",
        governanceProfile: "guarded",
        ownerId: "owner_1",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_test/tier",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tier).toBe("smb");
      expect(body.smbConfig).toEqual({
        tier: "smb",
        governanceProfile: "guarded",
        ownerId: "owner_1",
      });
    });

    it("returns tier with null smbConfig for enterprise org", async () => {
      mockTierStore.getTier.mockResolvedValue("enterprise");

      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_test/tier",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tier).toBe("enterprise");
      expect(body.smbConfig).toBeNull();
      // getSmbConfig should not be called for enterprise
      expect(mockTierStore.getSmbConfig).not.toHaveBeenCalled();
    });

    it("returns 403 when org in URL does not match auth org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/smb/org_other/tier",
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── PUT /api/smb/:orgId/tier ───────────────────────────────────────

  describe("PUT /api/smb/:orgId/tier", () => {
    it("updates SMB config successfully", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      mockTierStore.getSmbConfig.mockResolvedValue({
        tier: "smb",
        governanceProfile: "guarded",
        ownerId: "owner_1",
        allowedActionTypes: undefined,
        blockedActionTypes: undefined,
        perActionSpendLimit: null,
        dailySpendLimit: null,
      });
      mockTierStore.setSmbConfig.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "PUT",
        url: "/api/smb/org_test/tier",
        payload: {
          governanceProfile: "strict",
          dailySpendLimit: 5000,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.config.governanceProfile).toBe("strict");
      expect(body.config.dailySpendLimit).toBe(5000);
      expect(body.config.tier).toBe("smb");

      expect(mockTierStore.setSmbConfig).toHaveBeenCalledWith(
        "org_test",
        expect.objectContaining({
          tier: "smb",
          governanceProfile: "strict",
          dailySpendLimit: 5000,
        }),
      );
    });

    it("returns 400 for non-SMB organization", async () => {
      mockTierStore.getTier.mockResolvedValue("enterprise");

      const res = await app.inject({
        method: "PUT",
        url: "/api/smb/org_test/tier",
        payload: { governanceProfile: "strict" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("SMB");
    });

    it("returns 400 when ownerId is missing on new config", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      // No existing config
      mockTierStore.getSmbConfig.mockResolvedValue(null);

      const res = await app.inject({
        method: "PUT",
        url: "/api/smb/org_test/tier",
        payload: { governanceProfile: "guarded" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("ownerId is required");
    });

    it("allows creating initial config with ownerId", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      mockTierStore.getSmbConfig.mockResolvedValue(null);
      mockTierStore.setSmbConfig.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "PUT",
        url: "/api/smb/org_test/tier",
        payload: {
          governanceProfile: "observe",
          ownerId: "owner_new",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.config.ownerId).toBe("owner_new");
      expect(body.config.governanceProfile).toBe("observe");
    });

    it("returns 403 when org in URL does not match auth org", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/smb/org_mismatch/tier",
        payload: { governanceProfile: "strict" },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /api/smb/:orgId/upgrade ───────────────────────────────────

  describe("POST /api/smb/:orgId/upgrade", () => {
    it("upgrades SMB org to enterprise", async () => {
      mockTierStore.getTier.mockResolvedValue("smb");
      mockTierStore.upgradeTier.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/smb/org_test/upgrade",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tier).toBe("enterprise");
      expect(body.message).toContain("upgraded");

      expect(mockTierStore.upgradeTier).toHaveBeenCalledWith("org_test", "enterprise");
    });

    it("returns 400 if already enterprise", async () => {
      mockTierStore.getTier.mockResolvedValue("enterprise");

      const res = await app.inject({
        method: "POST",
        url: "/api/smb/org_test/upgrade",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("already on enterprise");
    });

    it("returns 403 when org in URL does not match auth org", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/smb/org_wrong/upgrade",
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
