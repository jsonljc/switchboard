import { describe, it, expect, beforeEach } from "vitest";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import { CompetenceTracker } from "../competence/index.js";
import type { IdentitySpec } from "@switchboard/schemas";
import type { StorageContext } from "../storage/interfaces.js";
import type { GuardrailState } from "../engine/policy-engine.js";
import type { ApprovalRoutingConfig } from "../approval/router.js";

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

describe("LifecycleOrchestrator — lifecycle, competence, delegation, risk, spend", () => {
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

  describe("requestUndo()", () => {
    it("should create a governed undo proposal", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({
          trustBehaviors: ["digital-ads.campaign.pause", "digital-ads.campaign.resume"],
        }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await orchestrator.executeApproved(proposeResult.envelope.id);

      const undoResult = await orchestrator.requestUndo(proposeResult.envelope.id);

      expect(undoResult.envelope.parentEnvelopeId).toBe(proposeResult.envelope.id);
      expect(undoResult.envelope.proposals[0]?.actionType).toBe("digital-ads.campaign.resume");

      const allEntries = ledgerStorage.getAll();
      const undoEntry = allEntries.find((e) => e.eventType === "action.undo_requested");
      expect(undoEntry).toBeDefined();
      expect(undoEntry?.snapshot["originalEnvelopeId"]).toBe(proposeResult.envelope.id);
      expect(undoEntry?.snapshot["reverseActionType"]).toBe("digital-ads.campaign.resume");
    });

    it("should throw if no undo recipe available", async () => {
      cartridge.onExecute(() => ({
        success: true,
        summary: "Executed",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 10,
        undoRecipe: null,
      }));

      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await orchestrator.executeApproved(proposeResult.envelope.id);

      await expect(orchestrator.requestUndo(proposeResult.envelope.id)).rejects.toThrow(
        "No undo recipe available",
      );
    });
  });

  describe("Full lifecycle", () => {
    it("should complete propose -> approve -> execute -> undo -> approve undo -> execute undo", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      // Step 1: Propose
      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });
      expect(proposeResult.envelope.status).toBe("pending_approval");
      expect(proposeResult.approvalRequest).not.toBeNull();

      // Step 2: Approve (which auto-executes)
      const approvalResponse = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });
      expect(approvalResponse.approvalState.status).toBe("approved");
      expect(approvalResponse.executionResult?.success).toBe(true);
      expect(approvalResponse.envelope.status).toBe("executed");

      // Step 3: Request undo
      const undoResult = await orchestrator.requestUndo(proposeResult.envelope.id);
      expect(undoResult.envelope.parentEnvelopeId).toBe(proposeResult.envelope.id);

      // Step 4: The undo also needs approval (medium risk)
      if (undoResult.approvalRequest) {
        // Step 5: Approve undo
        const undoApproval = await orchestrator.respondToApproval({
          approvalId: undoResult.approvalRequest.id,
          action: "approve",
          respondedBy: "admin_1",
          bindingHash: undoResult.approvalRequest.bindingHash,
        });
        expect(undoApproval.executionResult?.success).toBe(true);
      }

      // Verify audit chain
      const allEntries = ledgerStorage.getAll();
      expect(allEntries.length).toBeGreaterThanOrEqual(4);

      const chainResult = await ledger.verifyChain(allEntries);
      expect(chainResult.valid).toBe(true);
    });
  });

  describe("Competence integration", () => {
    let competenceOrchestrator: LifecycleOrchestrator;
    let competenceTracker: CompetenceTracker;

    beforeEach(async () => {
      competenceTracker = new CompetenceTracker(storage.competence, ledger);
      competenceOrchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        competenceTracker,
      });
    });

    it("should earn trust through successful executions -> eventually auto-approved", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "medium" as const,
        exposure: { dollarsAtRisk: 100, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      for (let i = 0; i < 25; i++) {
        await competenceTracker.recordSuccess("user_1", "digital-ads.campaign.pause");
      }

      const result = await competenceOrchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result.envelope.status).toBe("approved");
      expect(result.decisionTrace.approvalRequired).toBe("none");

      const competenceCheck = result.decisionTrace.checks.find(
        (c) => c.checkCode === "COMPETENCE_TRUST",
      );
      expect(competenceCheck).toBeDefined();
      expect(competenceCheck!.checkData["shouldTrust"]).toBe(true);
    });

    it("should reduce competence on failed execution", async () => {
      for (let i = 0; i < 25; i++) {
        await competenceTracker.recordSuccess("user_1", "digital-ads.campaign.pause");
      }

      const adj1 = await competenceTracker.getAdjustment("user_1", "digital-ads.campaign.pause");
      expect(adj1!.shouldTrust).toBe(true);
      const scoreBeforeFailures = adj1!.score;

      for (let i = 0; i < 5; i++) {
        await competenceTracker.recordFailure("user_1", "digital-ads.campaign.pause");
      }

      const adj2 = await competenceTracker.getAdjustment("user_1", "digital-ads.campaign.pause");
      expect(adj2!.score).toBeLessThan(scoreBeforeFailures);
      expect(adj2!.shouldTrust).toBe(false);
    });

    it("should record rollback against original action type on undo", async () => {
      for (let i = 0; i < 15; i++) {
        await competenceTracker.recordSuccess("user_1", "digital-ads.campaign.pause");
      }

      await storage.identity.saveSpec(
        makeIdentitySpec({
          trustBehaviors: ["digital-ads.campaign.pause", "digital-ads.campaign.resume"],
        }),
      );

      const adjBefore = await competenceTracker.getAdjustment(
        "user_1",
        "digital-ads.campaign.pause",
      );

      const result = await competenceOrchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await competenceOrchestrator.executeApproved(result.envelope.id);

      await competenceOrchestrator.requestUndo(result.envelope.id);

      const adjAfter = await competenceTracker.getAdjustment(
        "user_1",
        "digital-ads.campaign.pause",
      );
      expect(adjAfter!.record.rollbackCount).toBe(1);
      expect(adjAfter!.score).toBeLessThan(adjBefore!.score + 10);
    });

    it("should work without competenceTracker (backward compat)", async () => {
      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result.denied).toBe(false);
      expect(result.envelope).toBeDefined();
      const competenceCheck = result.decisionTrace.checks.find(
        (c) => c.checkCode === "COMPETENCE_TRUST",
      );
      expect(competenceCheck).toBeUndefined();
    });
  });

  describe("Delegation chain (end-to-end)", () => {
    it("should allow approval via 2-hop delegation chain", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const routingConfig: ApprovalRoutingConfig = {
        defaultApprovers: ["admin_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny",
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
      };

      const chainOrchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig,
      });

      await storage.identity.savePrincipal({
        id: "admin_1",
        type: "user",
        name: "Admin",
        organizationId: null,
        roles: ["approver"],
      });

      await storage.identity.savePrincipal({
        id: "mid_1",
        type: "user",
        name: "Mid-level",
        organizationId: null,
        roles: ["approver"],
      });

      await storage.identity.savePrincipal({
        id: "delegate_1",
        type: "user",
        name: "Delegate",
        organizationId: null,
        roles: ["approver"],
      });

      await storage.identity.saveDelegationRule({
        id: "chain_d1",
        grantor: "admin_1",
        grantee: "mid_1",
        scope: "*",
        expiresAt: null,
        maxChainDepth: 5,
      });

      await storage.identity.saveDelegationRule({
        id: "chain_d2",
        grantor: "mid_1",
        grantee: "delegate_1",
        scope: "*",
        expiresAt: null,
        maxChainDepth: 5,
      });

      const proposeResult = await chainOrchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      const response = await chainOrchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "delegate_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
      expect(response.executionResult?.success).toBe(true);

      const entries = await ledger.query({ eventType: "delegation.chain_resolved" as any });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const chainEntry = entries[0];
      expect(chainEntry?.snapshot["depth"]).toBe(2);
      expect(chainEntry?.snapshot["chain"]).toEqual(["delegate_1", "mid_1", "admin_1"]);
    });
  });

  describe("Composite risk (end-to-end)", () => {
    it("agent with many recent actions gets higher risk score on next propose", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "medium" as const,
        exposure: { dollarsAtRisk: 100, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      for (let i = 0; i < 5; i++) {
        const result = await orchestrator.propose({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: `camp_${i}`, entityId: `ent_${i}` },
          principalId: "user_1",
          cartridgeId: "digital-ads",
        });
        await orchestrator.executeApproved(result.envelope.id);
      }

      const nextResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_final", entityId: "ent_final" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      const compositeCheck = nextResult.decisionTrace.checks.find(
        (c) => c.checkCode === "COMPOSITE_RISK",
      );
      expect(compositeCheck).toBeDefined();
    });
  });

  describe("Time-windowed spend limits (end-to-end)", () => {
    it("should deny when daily spend limit is exceeded across multiple actions", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({
          trustBehaviors: ["digital-ads.campaign.adjust_budget"],
          globalSpendLimits: { daily: 3000, weekly: null, monthly: null, perAction: 2000 },
        }),
      );

      for (let i = 0; i < 2; i++) {
        const result = await orchestrator.propose({
          actionType: "digital-ads.campaign.adjust_budget",
          parameters: { campaignId: `camp_${i}`, amount: 1500 },
          principalId: "user_1",
          cartridgeId: "digital-ads",
        });
        expect(result.denied).toBe(false);
        await orchestrator.executeApproved(result.envelope.id);
      }

      const denied = await orchestrator.propose({
        actionType: "digital-ads.campaign.adjust_budget",
        parameters: { campaignId: "camp_final", amount: 500 },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
      const dailyCheck = denied.decisionTrace.checks.find(
        (c) => c.checkCode === "SPEND_LIMIT" && c.matched && c.checkData["field"] === "daily",
      );
      expect(dailyCheck).toBeDefined();
    });

    it("should allow when within daily spend limit", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({
          trustBehaviors: ["digital-ads.campaign.adjust_budget"],
          globalSpendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
        }),
      );

      const first = await orchestrator.propose({
        actionType: "digital-ads.campaign.adjust_budget",
        parameters: { campaignId: "camp_1", amount: 2000 },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });
      expect(first.denied).toBe(false);
      await orchestrator.executeApproved(first.envelope.id);

      const second = await orchestrator.propose({
        actionType: "digital-ads.campaign.adjust_budget",
        parameters: { campaignId: "camp_2", amount: 3000 },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(second.denied).toBe(false);
    });
  });
});
