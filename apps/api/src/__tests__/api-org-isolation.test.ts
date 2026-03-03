import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { actionsRoutes } from "../routes/actions.js";
import { governanceRoutes } from "../routes/governance.js";
import { identityRoutes } from "../routes/identity.js";
import { campaignsRoutes } from "../routes/campaigns.js";
import {
  LifecycleOrchestrator,
  createInMemoryStorage,
  seedDefaultStorage,
  InMemoryLedgerStorage,
  AuditLedger,
  createGuardrailState,
  InMemoryPolicyCache,
  InMemoryGovernanceProfileStore,
  ExecutionService,
} from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";

/**
 * Build a test server with org-scoped auth simulation.
 * When orgId is provided, all requests will have organizationIdFromAuth set.
 */
async function buildOrgScopedTestServer(orgId?: string) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal server error" : error.message;
    return reply.code(statusCode).send({ error: message, statusCode });
  });

  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  const cartridge = new TestCartridge(
    createTestManifest({
      id: "digital-ads",
      actions: [
        {
          actionType: "digital-ads.campaign.pause",
          name: "Pause Campaign",
          description: "Pause a campaign",
          parametersSchema: {},
          baseRiskCategory: "low" as const,
          reversible: true,
        },
      ],
    }),
  );

  cartridge.onRiskInput(() => ({
    baseRisk: "low" as const,
    exposure: { dollarsAtRisk: 10, blastRadius: 1 },
    reversibility: "full" as const,
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }));

  cartridge.onExecute((_actionType, params) => ({
    success: true,
    summary: `Executed ${_actionType}`,
    externalRefs: { campaignId: (params["campaignId"] as string) ?? "unknown" },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 15,
    undoRecipe: null,
  }));

  storage.cartridges.register("digital-ads", cartridge);

  await storage.policies.save({
    id: "default-allow-ads",
    name: "Default allow digital-ads",
    description: "Allow all digital-ads actions",
    organizationId: null,
    cartridgeId: "digital-ads",
    priority: 100,
    active: true,
    rule: { composition: "AND", conditions: [], children: [] },
    effect: "allow",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await seedDefaultStorage(storage);

  await storage.identity.savePrincipal({
    id: "default",
    type: "user",
    name: "Default User",
    organizationId: null,
    roles: ["requester"],
  });
  await storage.identity.savePrincipal({
    id: "reviewer_1",
    type: "user",
    name: "Reviewer 1",
    organizationId: null,
    roles: ["approver"],
  });

  const orchestrator = new LifecycleOrchestrator({
    storage,
    ledger,
    guardrailState,
    policyCache,
    governanceProfileStore,
    routingConfig: {
      defaultApprovers: ["reviewer_1"],
      defaultFallbackApprover: null,
      defaultExpiryMs: 24 * 60 * 60 * 1000,
      defaultExpiredBehavior: "deny" as const,
      elevatedExpiryMs: 12 * 60 * 60 * 1000,
      mandatoryExpiryMs: 4 * 60 * 60 * 1000,
      denyWhenNoApprovers: true,
    },
  });

  const executionService = new ExecutionService(orchestrator, storage);
  app.decorate("orchestrator", orchestrator);
  app.decorate("storageContext", storage);
  app.decorate("auditLedger", ledger);
  app.decorate("policyCache", policyCache);
  app.decorate("executionService", executionService);
  app.decorate("governanceProfileStore", governanceProfileStore);

  // Simulate org-scoped auth
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);
  if (orgId) {
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = orgId;
    });
  }

  await app.register(actionsRoutes, { prefix: "/api/actions" });
  await app.register(governanceRoutes, { prefix: "/api/governance" });
  await app.register(identityRoutes, { prefix: "/api/identity" });
  await app.register(campaignsRoutes, { prefix: "/api/campaigns" });

  return { app, storage, orchestrator, cartridge };
}

describe("Organization Isolation (IDOR Protection)", () => {
  describe("Actions routes", () => {
    let app: FastifyInstance;
    let storage: StorageContext;

    beforeEach(async () => {
      const ctx = await buildOrgScopedTestServer("org_A");
      app = ctx.app;
      storage = ctx.storage;
    });

    afterEach(async () => {
      await app.close();
    });

    it("execute returns 403 when envelope belongs to different org", async () => {
      // Create an envelope directly in storage tagged to org_B
      const now = new Date();
      const envelope = {
        id: "env_cross_org_exec",
        version: 1,
        incomingMessage: null,
        conversationId: null,
        proposals: [
          {
            id: "prop_1",
            actionType: "digital-ads.campaign.pause",
            parameters: { campaignId: "camp_1", _organizationId: "org_B" },
            evidence: "test",
            confidence: 1.0,
            originatingMessageId: "",
          },
        ],
        resolvedEntities: [],
        plan: null,
        decisions: [],
        approvalRequests: [],
        executionResults: [],
        auditEntryIds: [],
        status: "approved" as const,
        createdAt: now,
        updatedAt: now,
        parentEnvelopeId: null,
        traceId: "trace_1",
      };
      await storage.envelopes.save(envelope);

      // Try to execute with org_A auth
      const execRes = await app.inject({
        method: "POST",
        url: `/api/actions/${envelope.id}/execute`,
      });
      expect(execRes.statusCode).toBe(403);
      expect(execRes.json().error).toContain("organization mismatch");
    });

    it("undo returns 403 when envelope belongs to different org", async () => {
      // Create an envelope directly in storage tagged to org_B
      const now = new Date();
      const envelope = {
        id: "env_cross_org_undo",
        version: 1,
        incomingMessage: null,
        conversationId: null,
        proposals: [
          {
            id: "prop_2",
            actionType: "digital-ads.campaign.pause",
            parameters: { campaignId: "camp_1", _organizationId: "org_B" },
            evidence: "test",
            confidence: 1.0,
            originatingMessageId: "",
          },
        ],
        resolvedEntities: [],
        plan: null,
        decisions: [],
        approvalRequests: [],
        executionResults: [],
        auditEntryIds: [],
        status: "executed" as const,
        createdAt: now,
        updatedAt: now,
        parentEnvelopeId: null,
        traceId: "trace_2",
      };
      await storage.envelopes.save(envelope);

      // Try to undo with org_A auth
      const undoRes = await app.inject({
        method: "POST",
        url: `/api/actions/${envelope.id}/undo`,
      });
      expect(undoRes.statusCode).toBe(403);
      expect(undoRes.json().error).toContain("organization mismatch");
    });

    it("execute returns 404 when envelope does not exist", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/nonexistent/execute",
      });
      expect(res.statusCode).toBe(404);
    });

    it("undo returns 404 when envelope does not exist", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/actions/nonexistent/undo",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("Governance routes", () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      const ctx = await buildOrgScopedTestServer("org_A");
      app = ctx.app;
    });

    afterEach(async () => {
      await app.close();
    });

    it("GET status returns 403 for cross-org read", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/governance/org_B/status",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("GET status returns 200 for own org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/governance/org_A/status",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().organizationId).toBe("org_A");
    });

    it("PUT profile returns 403 for cross-org write", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/governance/org_B/profile",
        payload: { profile: "observe" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("PUT profile returns 200 for own org", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/governance/org_A/profile",
        payload: { profile: "strict" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().profile).toBe("strict");
    });

    it("emergency-halt returns 403 for cross-org request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/governance/emergency-halt",
        payload: { organizationId: "org_B", reason: "test" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });
  });

  describe("Identity overlay routes", () => {
    let app: FastifyInstance;
    let storage: StorageContext;

    beforeEach(async () => {
      const ctx = await buildOrgScopedTestServer("org_A");
      app = ctx.app;
      storage = ctx.storage;
    });

    afterEach(async () => {
      await app.close();
    });

    it("GET overlays returns 403 when parent spec belongs to different org", async () => {
      // Create a spec owned by org_B
      const specId = "spec_org_b";
      const defaultRiskTolerance = {
        none: "none" as const,
        low: "none" as const,
        medium: "standard" as const,
        high: "elevated" as const,
        critical: "mandatory" as const,
      };
      const defaultSpendLimits = { daily: null, weekly: null, monthly: null, perAction: null };

      await storage.identity.saveSpec({
        id: specId,
        organizationId: "org_B",
        principalId: "user_b",
        name: "Org B User",
        description: "Test spec for org B",
        riskTolerance: defaultRiskTolerance,
        globalSpendLimits: defaultSpendLimits,
        cartridgeSpendLimits: {},
        forbiddenBehaviors: [],
        trustBehaviors: [],
        delegatedApprovers: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/identity/overlays?specId=${specId}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("GET overlays returns 200 for own org spec", async () => {
      const specId = "spec_org_a";
      const defaultRiskTolerance = {
        none: "none" as const,
        low: "none" as const,
        medium: "standard" as const,
        high: "elevated" as const,
        critical: "mandatory" as const,
      };
      const defaultSpendLimits = { daily: null, weekly: null, monthly: null, perAction: null };

      await storage.identity.saveSpec({
        id: specId,
        organizationId: "org_A",
        principalId: "user_a",
        name: "Org A User",
        description: "Test spec for org A",
        riskTolerance: defaultRiskTolerance,
        globalSpendLimits: defaultSpendLimits,
        cartridgeSpendLimits: {},
        forbiddenBehaviors: [],
        trustBehaviors: [],
        delegatedApprovers: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/identity/overlays?specId=${specId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().overlays).toBeDefined();
    });
  });

  describe("Campaign routes", () => {
    let app: FastifyInstance;
    let appNoOrg: FastifyInstance;

    beforeEach(async () => {
      const ctx = await buildOrgScopedTestServer("org_A");
      app = ctx.app;

      // Build a server without org auth
      const ctxNoOrg = await buildOrgScopedTestServer();
      appNoOrg = ctxNoOrg.app;
    });

    afterEach(async () => {
      await app.close();
      await appNoOrg.close();
    });

    it("GET campaign returns 403 when no org auth", async () => {
      const res = await appNoOrg.inject({
        method: "GET",
        url: "/api/campaigns/camp_1",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("API key must be scoped to an organization");
    });

    it("GET search returns 403 when no org auth", async () => {
      const res = await appNoOrg.inject({
        method: "GET",
        url: "/api/campaigns/search?query=test",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("API key must be scoped to an organization");
    });
  });
});
