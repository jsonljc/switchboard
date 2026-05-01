import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock readiness module BEFORE importing governanceRoutes. Vitest hoists
// vi.mock to the top of the file, but the hoist only works at module scope —
// not inside describe blocks. The resume route's happy path queries four
// Prisma models via buildReadinessContext; mocking the readiness helpers
// directly is simpler than building deep Prisma stubs in every test.
vi.mock("../routes/readiness.js", () => ({
  checkReadiness: vi.fn(() => ({ ready: true, checks: [] })),
  buildReadinessContext: vi.fn(async () => ({ deployment: { status: "paused" } })),
}));

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

  const mockPlatformIngress = {
    submit: vi.fn(),
  };

  const mockDeploymentLifecycleStore = {
    haltAll: vi.fn(),
    resume: vi.fn(),
    suspendAll: vi.fn(),
  };

  const mockAuditLedger = {
    record: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default resolved values — pre-existing tests rely on the route receiving a
    // benign object so it can read `.count` / `.affectedDeploymentIds` without
    // throwing. Tests that care about specific values override via
    // mockDeploymentLifecycleStore.haltAll.mockResolvedValueOnce(...) inside the test body.
    mockDeploymentLifecycleStore.haltAll.mockResolvedValue({
      workTraceId: "wt_default_halt",
      affectedDeploymentIds: [],
      count: 0,
    });
    mockDeploymentLifecycleStore.resume.mockResolvedValue({
      workTraceId: "wt_default_resume",
      affectedDeploymentIds: [],
      count: 0,
    });
    mockDeploymentLifecycleStore.suspendAll.mockResolvedValue({
      workTraceId: "wt_default_suspend",
      affectedDeploymentIds: [],
      count: 0,
    });

    app = Fastify({ logger: false });

    app.decorate("authDisabled", true);
    app.decorate("governanceProfileStore", mockGovernanceProfileStore);
    app.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
    app.decorate("platformIngress", mockPlatformIngress as unknown as never);
    app.decorate("deploymentLifecycleStore", mockDeploymentLifecycleStore as unknown as never);
    app.decorate("auditLedger", mockAuditLedger as unknown as never);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.decorateRequest("principalIdFromAuth", undefined);

    app.addHook("onRequest", async (request) => {
      const params = request.params as { orgId?: string };
      if (params.orgId) {
        (request as unknown as Record<string, unknown>).organizationIdFromAuth = params.orgId;
        (request as unknown as Record<string, unknown>).principalIdFromAuth = "test-principal";
      }
    });

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
      expect(body.error.toLowerCase()).toContain("required");
    });

    it("returns 400 for invalid profile value", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/governance/org_123/profile",
        payload: { profile: "banana" },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      // Zod enum validation produces: "Invalid enum value. Expected '...' | '...', received 'banana'"
      expect(body.error.toLowerCase()).toContain("invalid");
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

      mockPlatformIngress.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "completed", summary: "Campaign paused" },
        workUnit: { id: "wu_1" },
      });

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
        searchCampaigns: vi.fn().mockResolvedValue([{ id: "camp_fail", status: "ACTIVE" }]),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      mockPlatformIngress.submit.mockRejectedValue(new Error("Platform ingress down"));

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
      expect(body.failures[0].error).toBe("Platform ingress down");
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
        searchCampaigns: vi.fn().mockResolvedValue([{ id: "camp_denied", status: "ACTIVE" }]),
      };
      mockCartridges.get.mockReturnValue(mockCartridge);

      mockPlatformIngress.submit.mockResolvedValue({
        ok: true,
        result: { outcome: "failed", summary: "Denied by governance" },
        workUnit: { id: "wu_denied" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.campaignsPaused).toEqual([]);
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

    it("calls deploymentLifecycleStore.haltAll and surfaces the count", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);
      mockCartridges.get.mockReturnValue(undefined);
      mockDeploymentLifecycleStore.haltAll.mockResolvedValueOnce({
        workTraceId: "wt_halt_1",
        affectedDeploymentIds: ["d1", "d2"],
        count: 2,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123", reason: "incident" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deploymentsPaused).toBe(2);
      expect(mockDeploymentLifecycleStore.haltAll).toHaveBeenCalledWith({
        organizationId: "org_123",
        operator: { type: "user", id: "operator" },
        reason: "incident",
      });
    });

    it("returns 503 when deploymentLifecycleStore is null", async () => {
      const localApp = Fastify({ logger: false });
      localApp.decorate("authDisabled", true);
      localApp.decorate("governanceProfileStore", mockGovernanceProfileStore);
      localApp.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
      localApp.decorate("platformIngress", mockPlatformIngress as unknown as never);
      localApp.decorate("deploymentLifecycleStore", null);
      localApp.decorate("auditLedger", mockAuditLedger as unknown as never);
      localApp.decorateRequest("organizationIdFromAuth", undefined);
      localApp.decorateRequest("principalIdFromAuth", undefined);
      await localApp.register(governanceRoutes, { prefix: "/api/governance" });

      const res = await localApp.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(503);
      await localApp.close();
    });
  });

  // ── POST /api/governance/resume ────────────────────────────────────

  describe("POST /api/governance/resume", () => {
    it("calls deploymentLifecycleStore.resume scoped to skillSlug=alex", async () => {
      mockGovernanceProfileStore.set.mockResolvedValue(undefined);
      mockDeploymentLifecycleStore.resume.mockResolvedValueOnce({
        workTraceId: "wt_resume_1",
        affectedDeploymentIds: ["d_alex"],
        count: 1,
      });
      // Decorate prisma so the early-exit guard does not short-circuit. The
      // actual buildReadinessContext + checkReadiness are mocked at module top.
      app.decorate("prisma", {} as unknown as never);

      const res = await app.inject({
        method: "POST",
        url: "/api/governance/resume",
        payload: { organizationId: "org_123" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockDeploymentLifecycleStore.resume).toHaveBeenCalledWith({
        organizationId: "org_123",
        skillSlug: "alex",
        operator: { type: "user", id: "operator" },
      });
      const body = res.json();
      expect(body.resumed).toBe(true);
      expect(body.profile).toBe("guarded");
    });

    it("returns 503 when deploymentLifecycleStore is null", async () => {
      const localApp = Fastify({ logger: false });
      localApp.decorate("authDisabled", true);
      localApp.decorate("governanceProfileStore", mockGovernanceProfileStore);
      localApp.decorate("storageContext", { cartridges: mockCartridges } as unknown as never);
      localApp.decorate("platformIngress", mockPlatformIngress as unknown as never);
      localApp.decorate("deploymentLifecycleStore", null);
      localApp.decorate("auditLedger", mockAuditLedger as unknown as never);
      localApp.decorate("prisma", {} as unknown as never);
      localApp.decorateRequest("organizationIdFromAuth", undefined);
      localApp.decorateRequest("principalIdFromAuth", undefined);
      await localApp.register(governanceRoutes, { prefix: "/api/governance" });

      const res = await localApp.inject({
        method: "POST",
        url: "/api/governance/resume",
        payload: { organizationId: "org_123" },
      });

      // The store-null guard fires AFTER readiness passes (mocked to ready:true above).
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error).toMatch(/store unavailable/i);
      await localApp.close();
    });
  });

  // ── Cross-org access control ─────────────────────────────────────

  describe("Cross-org access control", () => {
    let scopedApp: FastifyInstance;

    beforeEach(async () => {
      scopedApp = Fastify({ logger: false });

      const scopedMockGovernanceProfileStore = {
        get: vi.fn().mockResolvedValue("guarded"),
        set: vi.fn(),
        getConfig: vi.fn().mockResolvedValue(null),
        setConfig: vi.fn(),
      };

      const scopedMockCartridges = { get: vi.fn() };
      const scopedMockOrchestrator = { propose: vi.fn(), executeApproved: vi.fn() };

      // Auth-enabled scoped app — set authDisabled=false so the scoped routes treat
      // the request as coming from a real, org-bound API key.
      scopedApp.decorate("authDisabled", false);
      scopedApp.decorate("governanceProfileStore", scopedMockGovernanceProfileStore);
      scopedApp.decorate("storageContext", {
        cartridges: scopedMockCartridges,
      } as unknown as never);
      scopedApp.decorate("orchestrator", scopedMockOrchestrator as unknown as never);

      scopedApp.decorateRequest("organizationIdFromAuth", undefined);
      scopedApp.decorateRequest("principalIdFromAuth", undefined);
      scopedApp.addHook("onRequest", async (request) => {
        request.organizationIdFromAuth = "org_A";
      });

      await scopedApp.register(governanceRoutes, { prefix: "/api/governance" });
    });

    afterEach(async () => {
      await scopedApp.close();
    });

    it("GET status returns 403 for cross-org read", async () => {
      const res = await scopedApp.inject({
        method: "GET",
        url: "/api/governance/org_B/status",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("PUT profile returns 403 for cross-org write", async () => {
      const res = await scopedApp.inject({
        method: "PUT",
        url: "/api/governance/org_B/profile",
        payload: { profile: "observe" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("emergency-halt returns 400 for cross-org body claim", async () => {
      const res = await scopedApp.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_B", reason: "test" },
      });
      // Auth says org_A; body says org_B → mismatch is a 400 (caller bug), not a 403.
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("does not match authenticated context");
    });

    it("emergency-halt returns 403 when auth is enabled but no org binding", async () => {
      // Auth is enabled (authDisabled=false) but the request has no organizationIdFromAuth.
      // This is the unscoped-static-API-key scenario. Must fail closed, not be treated as dev mode.
      const noOrgApp = Fastify({ logger: false });
      const noOrgStore = {
        get: vi.fn(),
        set: vi.fn(),
        getConfig: vi.fn(),
        setConfig: vi.fn(),
      };

      noOrgApp.decorate("authDisabled", false);
      noOrgApp.decorate("governanceProfileStore", noOrgStore);
      noOrgApp.decorate("storageContext", { cartridges: { get: vi.fn() } } as unknown as never);
      noOrgApp.decorate("orchestrator", {
        propose: vi.fn(),
        executeApproved: vi.fn(),
      } as unknown as never);
      noOrgApp.decorateRequest("organizationIdFromAuth", undefined);
      noOrgApp.decorateRequest("principalIdFromAuth", undefined);
      await noOrgApp.register(governanceRoutes, { prefix: "/api/governance" });

      const res = await noOrgApp.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_X" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("no organization binding");

      await noOrgApp.close();
    });
  });
});
