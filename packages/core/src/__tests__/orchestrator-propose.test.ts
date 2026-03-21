import { describe, it, expect, beforeEach } from "vitest";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec } from "@switchboard/schemas";
import type { StorageContext } from "../storage/interfaces.js";
import type { GuardrailState } from "../engine/policy-engine.js";

function makeIdentitySpec(overrides?: Partial<IdentitySpec>): IdentitySpec {
  const now = new Date();
  return {
    id: "spec_test",
    principalId: "user_1",
    organizationId: null,
    name: "Test User",
    description: "Test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("LifecycleOrchestrator — propose()", () => {
  let storage: StorageContext;
  let ledger: AuditLedger;
  let ledgerStorage: InMemoryLedgerStorage;
  let guardrailState: GuardrailState;
  let orchestrator: LifecycleOrchestrator;
  let cartridge: TestCartridge;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledgerStorage = new InMemoryLedgerStorage();
    ledger = new AuditLedger(ledgerStorage);
    guardrailState = createGuardrailState();

    cartridge = new TestCartridge(createTestManifest({ id: "digital-ads" }));
    cartridge.onExecute((_actionType, params) => ({
      success: true,
      summary: `Executed ${_actionType}`,
      externalRefs: { campaignId: (params["campaignId"] as string) ?? "unknown" },
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: 15,
      undoRecipe: {
        originalActionId: (params["_actionId"] as string) ?? "unknown",
        originalEnvelopeId: (params["_envelopeId"] as string) ?? "unknown",
        reverseActionType: "digital-ads.campaign.resume",
        reverseParameters: { campaignId: params["campaignId"] },
        undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        undoRiskCategory: "medium",
        undoApprovalRequired: "none",
      },
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

    await storage.identity.saveSpec(makeIdentitySpec());

    await storage.identity.savePrincipal({
      id: "admin_1",
      type: "user",
      name: "Admin",
      organizationId: null,
      roles: ["approver"],
    });

    orchestrator = new LifecycleOrchestrator({
      storage,
      ledger,
      guardrailState,
      routingConfig: {
        defaultApprovers: ["admin_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny",
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
      },
    });
  });

  describe("propose()", () => {
    it("should return denied when action is forbidden", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({
          forbiddenBehaviors: ["digital-ads.campaign.pause"],
        }),
      );

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result.denied).toBe(true);
      expect(result.envelope.status).toBe("denied");
      expect(result.decisionTrace.finalDecision).toBe("deny");
      expect(result.approvalRequest).toBeNull();
    });

    it("should auto-allow trusted behaviors", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({
          trustBehaviors: ["digital-ads.campaign.pause"],
        }),
      );

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result.denied).toBe(false);
      expect(result.envelope.status).toBe("approved");
      expect(result.decisionTrace.approvalRequired).toBe("none");
      expect(result.approvalRequest).toBeNull();
    });

    it("should require approval for medium risk", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result.denied).toBe(false);
      expect(result.envelope.status).toBe("pending_approval");
      expect(result.approvalRequest).not.toBeNull();
      expect(result.approvalRequest?.bindingHash).toBeTruthy();
    });

    it("should save envelope and record audit", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      const saved = await storage.envelopes.getById(result.envelope.id);
      expect(saved).not.toBeNull();

      expect(result.envelope.auditEntryIds.length).toBeGreaterThan(0);
      const entries = await ledger.query({ envelopeId: result.envelope.id });
      expect(entries.length).toBeGreaterThan(0);

      const proposedEntry = entries.find((e) => e.eventType === "action.proposed");
      expect(proposedEntry).toBeDefined();
      expect(proposedEntry?.snapshot["riskScore"]).toBeDefined();
      expect(typeof proposedEntry?.snapshot["riskScore"]).toBe("number");
      expect(proposedEntry?.snapshot["riskCategory"]).toBeDefined();
      expect(Array.isArray(proposedEntry?.snapshot["matchedChecks"])).toBe(true);
    });

    it("should throw for unknown principal", async () => {
      await expect(
        orchestrator.propose({
          actionType: "digital-ads.campaign.pause",
          parameters: {},
          principalId: "unknown_user",
          cartridgeId: "digital-ads",
        }),
      ).rejects.toThrow("Identity spec not found");
    });

    it("should throw for unknown cartridge", async () => {
      await expect(
        orchestrator.propose({
          actionType: "some.action",
          parameters: {},
          principalId: "user_1",
          cartridgeId: "nonexistent",
        }),
      ).rejects.toThrow("Cartridge not found");
    });
  });

  describe("simulate()", () => {
    it("should return simulation result without side effects", async () => {
      const result = await orchestrator.simulate({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result.decisionTrace).toBeDefined();
      expect(result.wouldExecute).toBeDefined();
      expect(result.explanation).toBeDefined();

      const envelopes = await storage.envelopes.list();
      expect(envelopes).toHaveLength(0);

      const entries = await ledger.query({});
      expect(entries).toHaveLength(0);
    });
  });

  describe("resolveAndPropose()", () => {
    it("should return clarification for ambiguous entity", async () => {
      const cartridgeWithResolve = cartridge as TestCartridge & {
        resolveEntity: (
          inputRef: string,
          entityType: string,
          context: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      cartridgeWithResolve.resolveEntity = async (inputRef: string, entityType: string) => ({
        id: `resolve_${Date.now()}`,
        inputRef,
        resolvedType: entityType,
        resolvedId: "camp_1",
        resolvedName: "Summer Sale",
        confidence: 0.5,
        alternatives: [
          { id: "camp_1", name: "Summer Sale 2024", score: 0.5 },
          { id: "camp_2", name: "Summer Sale 2025", score: 0.5 },
        ],
        status: "ambiguous" as const,
      });

      const result = await orchestrator.resolveAndPropose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignRef: "Summer Sale" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
        entityRefs: [{ inputRef: "Summer Sale", entityType: "campaign" }],
      });

      expect("needsClarification" in result).toBe(true);
      if ("needsClarification" in result) {
        expect(result.question).toContain("Summer Sale");
      }
    });

    it("should resolve and propose when entity is clear", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const cartridgeWithResolve = cartridge as TestCartridge & {
        resolveEntity: (
          inputRef: string,
          entityType: string,
          context: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      cartridgeWithResolve.resolveEntity = async (inputRef: string, entityType: string) => ({
        id: `resolve_${Date.now()}`,
        inputRef,
        resolvedType: entityType,
        resolvedId: "camp_123",
        resolvedName: "Summer Sale",
        confidence: 0.95,
        alternatives: [],
        status: "resolved" as const,
      });

      const result = await orchestrator.resolveAndPropose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignRef: "Summer Sale" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
        entityRefs: [{ inputRef: "Summer Sale", entityType: "campaign" }],
      });

      expect("envelope" in result).toBe(true);
      if ("envelope" in result) {
        expect(result.envelope.status).toBe("approved");
        expect(result.envelope.proposals[0]?.parameters["campaignId"]).toBe("camp_123");
      }
    });

    it("should propose directly when no entity refs", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const result = await orchestrator.resolveAndPropose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
        entityRefs: [],
      });

      expect("envelope" in result).toBe(true);
    });
  });
});
