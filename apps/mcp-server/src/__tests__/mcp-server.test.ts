import { describe, it, expect, beforeEach } from "vitest";
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
  CartridgeReadAdapter,
} from "@switchboard/core";
import type { StorageContext } from "@switchboard/core";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import { DEFAULT_ADS_POLICIES } from "@switchboard/ads-spend";
import { handleSideEffectTool } from "../tools/side-effect.js";
import { handleReadTool } from "../tools/read.js";
import type { ReadToolDeps } from "../tools/read.js";
import type { McpAuthContext } from "../auth.js";
import { resolveAuth, loadMcpApiKeys } from "../auth.js";

// ── Test Harness ───────────────────────────────────────────────────────

interface TestContext {
  executionService: ExecutionService;
  readAdapter: CartridgeReadAdapter;
  orchestrator: LifecycleOrchestrator;
  storage: StorageContext;
  auth: McpAuthContext;
  readDeps: ReadToolDeps;
}

async function buildTestContext(): Promise<TestContext> {
  const storage = createInMemoryStorage();
  const ledgerStorage = new InMemoryLedgerStorage();
  const ledger = new AuditLedger(ledgerStorage);
  const guardrailState = createGuardrailState();
  const policyCache = new InMemoryPolicyCache();
  const governanceProfileStore = new InMemoryGovernanceProfileStore();

  // TestCartridge with ads-spend manifest
  const cartridge = new TestCartridge(
    createTestManifest({
      id: "ads-spend",
      actions: [
        { actionType: "ads.campaign.pause", name: "Pause Campaign", description: "Pause", parametersSchema: {}, baseRiskCategory: "medium" as const, reversible: true },
        { actionType: "ads.campaign.resume", name: "Resume Campaign", description: "Resume", parametersSchema: {}, baseRiskCategory: "medium" as const, reversible: true },
        { actionType: "ads.budget.adjust", name: "Adjust Budget", description: "Budget", parametersSchema: {}, baseRiskCategory: "high" as const, reversible: true },
        { actionType: "ads.targeting.modify", name: "Modify Targeting", description: "Targeting", parametersSchema: {}, baseRiskCategory: "high" as const, reversible: false },
      ],
    }),
  );

  cartridge.onRiskInput(() => ({
    baseRisk: "high" as const,
    exposure: { dollarsAtRisk: 500, blastRadius: 1 },
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cartridge as any).resolveEntity = async (
    inputRef: string,
    entityType: string,
  ) => ({
    id: `resolve_${Date.now()}`,
    inputRef,
    resolvedType: entityType,
    resolvedId: "camp_123",
    resolvedName: inputRef,
    confidence: 0.95,
    alternatives: [],
    status: "resolved" as const,
  });

  storage.cartridges.register("ads-spend", cartridge);
  await seedDefaultStorage(storage, DEFAULT_ADS_POLICIES);

  // Save principal for test actor
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
  const readAdapter = new CartridgeReadAdapter(storage, ledger);
  const auth: McpAuthContext = { actorId: "default", organizationId: null };

  const readDeps: ReadToolDeps = {
    readAdapter,
    orchestrator,
    storage,
  };

  return { executionService, readAdapter, orchestrator, storage, auth, readDeps };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("MCP Server", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestContext();
  });

  // ── Side-Effect Tools ────────────────────────────────────────────────

  describe("Side-Effect Tools", () => {
    it("pause_campaign goes through governance pipeline", async () => {
      const result = await handleSideEffectTool(
        "pause_campaign",
        { campaignId: "camp_123" },
        ctx.auth,
        ctx.executionService,
      );

      expect(result.outcome).toBeDefined();
      expect(result.envelopeId).toBeDefined();
      expect(result.traceId).toBeDefined();
      expect(["EXECUTED", "PENDING_APPROVAL", "DENIED"]).toContain(result.outcome);
    });

    it("resume_campaign goes through governance pipeline", async () => {
      const result = await handleSideEffectTool(
        "resume_campaign",
        { campaignId: "camp_123" },
        ctx.auth,
        ctx.executionService,
      );

      expect(result.outcome).toBeDefined();
      expect(result.envelopeId).toBeDefined();
      expect(["EXECUTED", "PENDING_APPROVAL", "DENIED"]).toContain(result.outcome);
    });

    it("adjust_budget goes through governance pipeline", async () => {
      const result = await handleSideEffectTool(
        "adjust_budget",
        { campaignId: "camp_123", newBudget: 100 },
        ctx.auth,
        ctx.executionService,
      );

      expect(result.outcome).toBeDefined();
      expect(result.envelopeId).toBeDefined();
      expect(["EXECUTED", "PENDING_APPROVAL", "DENIED"]).toContain(result.outcome);
    });

    it("modify_targeting goes through governance pipeline", async () => {
      const result = await handleSideEffectTool(
        "modify_targeting",
        { adSetId: "adset_123", targeting: { age_min: 25 } },
        ctx.auth,
        ctx.executionService,
      );

      expect(result.outcome).toBeDefined();
      expect(result.envelopeId).toBeDefined();
      expect(["EXECUTED", "PENDING_APPROVAL", "DENIED"]).toContain(result.outcome);
    });

    it("side-effect tools create envelopes", async () => {
      const result = await handleSideEffectTool(
        "pause_campaign",
        { campaignId: "camp_456" },
        ctx.auth,
        ctx.executionService,
      );

      const envelope = await ctx.storage.envelopes.getById(result.envelopeId);
      expect(envelope).not.toBeNull();
      expect(envelope!.proposals[0]!.actionType).toBe("ads.campaign.pause");
    });

    it("rejects invalid input", async () => {
      await expect(
        handleSideEffectTool(
          "pause_campaign",
          { campaignId: "" },
          ctx.auth,
          ctx.executionService,
        ),
      ).rejects.toThrow();
    });

    it("rejects unknown side-effect tool", async () => {
      await expect(
        handleSideEffectTool(
          "unknown_tool",
          {},
          ctx.auth,
          ctx.executionService,
        ),
      ).rejects.toThrow("Unknown side-effect tool");
    });
  });

  // ── Read-Only Tools ──────────────────────────────────────────────────

  describe("Read-Only Tools", () => {
    it("get_campaign returns data without creating envelopes", async () => {
      const envelopesBefore = await ctx.storage.envelopes.list({});
      const countBefore = envelopesBefore.length;

      const result = await handleReadTool(
        "get_campaign",
        { campaignId: "camp_123" },
        ctx.auth,
        ctx.readDeps,
      );

      expect(result).toBeDefined();
      expect((result as { traceId: string }).traceId).toBeDefined();

      // Read-only tools should NOT create envelopes
      const envelopesAfter = await ctx.storage.envelopes.list({});
      expect(envelopesAfter.length).toBe(countBefore);
    });

    it("search_campaigns returns results", async () => {
      const result = await handleReadTool(
        "search_campaigns",
        { query: "summer" },
        ctx.auth,
        ctx.readDeps,
      );

      expect(result).toBeDefined();
    });

    it("simulate_action returns decision without side effects", async () => {
      const envelopesBefore = await ctx.storage.envelopes.list({});
      const countBefore = envelopesBefore.length;

      const result = await handleReadTool(
        "simulate_action",
        { actionType: "ads.campaign.pause", parameters: { campaignId: "camp_123" } },
        ctx.auth,
        ctx.readDeps,
      ) as { decision: string; riskScore: number; riskCategory: string; approvalRequired: string };

      expect(result.decision).toBeDefined();
      expect(result.riskScore).toBeDefined();
      expect(result.riskCategory).toBeDefined();
      expect(result.approvalRequired).toBeDefined();

      // Simulation creates no envelopes
      const envelopesAfter = await ctx.storage.envelopes.list({});
      expect(envelopesAfter.length).toBe(countBefore);
    });

    it("get_approval_status returns approval details", async () => {
      // First create an action that needs approval
      const execResult = await handleSideEffectTool(
        "pause_campaign",
        { campaignId: "camp_789" },
        ctx.auth,
        ctx.executionService,
      );

      if (execResult.outcome === "PENDING_APPROVAL" && execResult.approvalId) {
        const result = await handleReadTool(
          "get_approval_status",
          { approvalId: execResult.approvalId },
          ctx.auth,
          ctx.readDeps,
        ) as { id: string; status: string };

        expect(result.id).toBe(execResult.approvalId);
        expect(result.status).toBeDefined();
      }
    });

    it("list_pending_approvals returns list", async () => {
      const result = await handleReadTool(
        "list_pending_approvals",
        {},
        ctx.auth,
        ctx.readDeps,
      ) as { approvals: unknown[] };

      expect(result.approvals).toBeDefined();
      expect(Array.isArray(result.approvals)).toBe(true);
    });

    it("get_action_status returns envelope details", async () => {
      const execResult = await handleSideEffectTool(
        "pause_campaign",
        { campaignId: "camp_abc" },
        ctx.auth,
        ctx.executionService,
      );

      const result = await handleReadTool(
        "get_action_status",
        { envelopeId: execResult.envelopeId },
        ctx.auth,
        ctx.readDeps,
      ) as { id: string; status: string; actionType: string };

      expect(result.id).toBe(execResult.envelopeId);
      expect(result.status).toBeDefined();
      expect(result.actionType).toBe("ads.campaign.pause");
    });

    it("get_action_status throws for non-existent envelope", async () => {
      await expect(
        handleReadTool(
          "get_action_status",
          { envelopeId: "non_existent" },
          ctx.auth,
          ctx.readDeps,
        ),
      ).rejects.toThrow("Envelope not found");
    });

    it("rejects unknown read tool", async () => {
      await expect(
        handleReadTool("unknown_read", {}, ctx.auth, ctx.readDeps),
      ).rejects.toThrow("Unknown read tool");
    });
  });

  // ── Governance Pipeline ──────────────────────────────────────────────

  describe("Governance Pipeline", () => {
    it("DENIED outcome formats correctly", async () => {
      // Add a deny policy for a specific action
      await ctx.storage.policies.save({
        id: "deny-test",
        name: "Deny Test",
        description: "Deny all targeting modifications",
        organizationId: null,
        cartridgeId: "ads-spend",
        priority: 0,
        active: true,
        rule: {
          composition: "AND" as const,
          conditions: [{ field: "actionType", operator: "eq" as const, value: "ads.targeting.modify" }],
        },
        effect: "deny" as const,
        effectParams: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await handleSideEffectTool(
        "modify_targeting",
        { adSetId: "adset_123", targeting: { age_min: 25 } },
        ctx.auth,
        ctx.executionService,
      );

      expect(result.outcome).toBe("DENIED");
      expect(result.deniedExplanation).toBeDefined();
    });

    it("PENDING_APPROVAL outcome includes approvalId", async () => {
      const result = await handleSideEffectTool(
        "pause_campaign",
        { campaignId: "camp_approval_test" },
        ctx.auth,
        ctx.executionService,
      );

      // With default risk scoring (high base risk), this should need approval
      if (result.outcome === "PENDING_APPROVAL") {
        expect(result.approvalId).toBeDefined();
        expect(result.summary).toBeDefined();
      }
    });
  });

  // ── Auth ─────────────────────────────────────────────────────────────

  describe("Auth", () => {
    it("resolves default auth in dev mode (no keys configured)", () => {
      const keys = new Map();
      const auth = resolveAuth(undefined, keys);
      expect(auth.actorId).toBe("default");
      expect(auth.organizationId).toBeNull();
    });

    it("resolves auth from configured key", () => {
      const keys = new Map([["test-key", { actorId: "user1", organizationId: "org1" }]]);
      const auth = resolveAuth("test-key", keys);
      expect(auth.actorId).toBe("user1");
      expect(auth.organizationId).toBe("org1");
    });

    it("rejects invalid key when keys are configured", () => {
      const keys = new Map([["valid-key", { actorId: "user1", organizationId: null }]]);
      expect(() => resolveAuth("bad-key", keys)).toThrow("Invalid API key");
    });

    it("rejects missing key when keys are configured", () => {
      const keys = new Map([["valid-key", { actorId: "user1", organizationId: null }]]);
      expect(() => resolveAuth(undefined, keys)).toThrow("Authentication required");
    });

    it("loads MCP API keys from environment", () => {
      const original = process.env["MCP_API_KEYS"];
      process.env["MCP_API_KEYS"] = "key1:actor1:org1,key2:actor2";
      try {
        const keys = loadMcpApiKeys();
        expect(keys.size).toBe(2);
        expect(keys.get("key1")).toEqual({ actorId: "actor1", organizationId: "org1" });
        expect(keys.get("key2")).toEqual({ actorId: "actor2", organizationId: null });
      } finally {
        if (original !== undefined) {
          process.env["MCP_API_KEYS"] = original;
        } else {
          delete process.env["MCP_API_KEYS"];
        }
      }
    });
  });
});
