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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("LifecycleOrchestrator", () => {
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

    cartridge = new TestCartridge(createTestManifest({ id: "ads-spend" }));
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
        reverseActionType: "ads.campaign.resume",
        reverseParameters: { campaignId: params["campaignId"] },
        undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        undoRiskCategory: "medium",
        undoApprovalRequired: "none",
      },
    }));

    storage.cartridges.register("ads-spend", cartridge);

    // Seed identity
    await storage.identity.saveSpec(makeIdentitySpec());

    orchestrator = new LifecycleOrchestrator({
      storage,
      ledger,
      guardrailState,
    });
  });

  describe("propose()", () => {
    it("should return denied when action is forbidden", async () => {
      // Update identity to forbid this action
      await storage.identity.saveSpec(
        makeIdentitySpec({
          forbiddenBehaviors: ["ads.campaign.pause"],
        }),
      );

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(result.denied).toBe(true);
      expect(result.envelope.status).toBe("denied");
      expect(result.decisionTrace.finalDecision).toBe("deny");
      expect(result.approvalRequest).toBeNull();
    });

    it("should auto-allow trusted behaviors", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({
          trustBehaviors: ["ads.campaign.pause"],
        }),
      );

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(result.denied).toBe(false);
      expect(result.envelope.status).toBe("approved");
      expect(result.decisionTrace.approvalRequired).toBe("none");
      expect(result.approvalRequest).toBeNull();
    });

    it("should require approval for medium risk", async () => {
      // Set up cartridge to return high base risk, which with $500 exposure
      // computes to a "medium" risk category (score ~56), triggering standard approval
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      // Identity requires standard approval for medium risk (default)
      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(result.denied).toBe(false);
      expect(result.envelope.status).toBe("pending_approval");
      expect(result.approvalRequest).not.toBeNull();
      expect(result.approvalRequest?.bindingHash).toBeTruthy();
    });

    it("should save envelope and record audit", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Verify envelope was saved
      const saved = await storage.envelopes.getById(result.envelope.id);
      expect(saved).not.toBeNull();

      // Verify audit entry was recorded
      expect(result.envelope.auditEntryIds.length).toBeGreaterThan(0);
      const entries = await ledger.query({ envelopeId: result.envelope.id });
      expect(entries.length).toBeGreaterThan(0);
    });

    it("should throw for unknown principal", async () => {
      await expect(
        orchestrator.propose({
          actionType: "ads.campaign.pause",
          parameters: {},
          principalId: "unknown_user",
          cartridgeId: "ads-spend",
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

  describe("respondToApproval()", () => {
    it("should approve and execute", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      const response = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
      expect(response.executionResult).not.toBeNull();
      expect(response.executionResult?.success).toBe(true);
      expect(response.envelope.status).toBe("executed");
    });

    it("should reject and set status denied", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      const response = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "reject",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("rejected");
      expect(response.executionResult).toBeNull();
      expect(response.envelope.status).toBe("denied");
    });

    it("should reject with wrong binding hash", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await expect(
        orchestrator.respondToApproval({
          approvalId: proposeResult.approvalRequest!.id,
          action: "approve",
          respondedBy: "admin_1",
          bindingHash: "wrong_hash",
        }),
      ).rejects.toThrow("Binding hash mismatch");
    });

    it("should handle expired approval", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Manually expire the approval by setting expiresAt in the past
      const approval = await storage.approvals.getById(proposeResult.approvalRequest!.id);
      expect(approval).not.toBeNull();
      await storage.approvals.updateState(proposeResult.approvalRequest!.id, {
        ...approval!.state,
        expiresAt: new Date(Date.now() - 1000),
      });

      const response = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("expired");
      expect(response.envelope.status).toBe("expired");
      expect(response.executionResult).toBeNull();
    });

    it("should throw for non-existent approval", async () => {
      await expect(
        orchestrator.respondToApproval({
          approvalId: "nonexistent",
          action: "approve",
          respondedBy: "admin",
          bindingHash: "abc",
        }),
      ).rejects.toThrow("Approval not found");
    });
  });

  describe("executeApproved()", () => {
    it("should execute an approved envelope", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(proposeResult.envelope.status).toBe("approved");

      const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
      expect(execResult.success).toBe(true);
      expect(execResult.undoRecipe).not.toBeNull();

      // Verify envelope status updated
      const updated = await storage.envelopes.getById(proposeResult.envelope.id);
      expect(updated?.status).toBe("executed");
    });

    it("should fail for non-approved envelope", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ forbiddenBehaviors: ["ads.campaign.pause"] }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await expect(
        orchestrator.executeApproved(proposeResult.envelope.id),
      ).rejects.toThrow('envelope status is denied, expected "approved"');
    });
  });

  describe("requestUndo()", () => {
    it("should create a governed undo proposal", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause", "ads.campaign.resume"] }),
      );

      // Execute an action
      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await orchestrator.executeApproved(proposeResult.envelope.id);

      // Request undo
      const undoResult = await orchestrator.requestUndo(proposeResult.envelope.id);

      expect(undoResult.envelope.parentEnvelopeId).toBe(proposeResult.envelope.id);
      // The undo uses the reverse action type from the recipe
      expect(undoResult.envelope.proposals[0]?.actionType).toBe("ads.campaign.resume");
    });

    it("should throw if no undo recipe available", async () => {
      // Create a cartridge that returns no undo recipe
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
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await orchestrator.executeApproved(proposeResult.envelope.id);

      await expect(
        orchestrator.requestUndo(proposeResult.envelope.id),
      ).rejects.toThrow("No undo recipe available");
    });
  });

  describe("simulate()", () => {
    it("should return simulation result without side effects", async () => {
      const result = await orchestrator.simulate({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(result.decisionTrace).toBeDefined();
      expect(result.wouldExecute).toBeDefined();
      expect(result.explanation).toBeDefined();

      // No envelopes should be saved
      const envelopes = await storage.envelopes.list();
      expect(envelopes).toHaveLength(0);

      // No audit entries
      const entries = await ledger.query({});
      expect(entries).toHaveLength(0);
    });
  });

  describe("resolveAndPropose()", () => {
    it("should return clarification for ambiguous entity", async () => {
      // Add resolveEntity to the cartridge
      const cartridgeWithResolve = cartridge as TestCartridge & {
        resolveEntity: (inputRef: string, entityType: string, context: Record<string, unknown>) => Promise<unknown>;
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
        actionType: "ads.campaign.pause",
        parameters: { campaignRef: "Summer Sale" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
        entityRefs: [{ inputRef: "Summer Sale", entityType: "campaign" }],
      });

      expect("needsClarification" in result).toBe(true);
      if ("needsClarification" in result) {
        expect(result.question).toContain("Summer Sale");
      }
    });

    it("should resolve and propose when entity is clear", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const cartridgeWithResolve = cartridge as TestCartridge & {
        resolveEntity: (inputRef: string, entityType: string, context: Record<string, unknown>) => Promise<unknown>;
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
        actionType: "ads.campaign.pause",
        parameters: { campaignRef: "Summer Sale" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
        entityRefs: [{ inputRef: "Summer Sale", entityType: "campaign" }],
      });

      expect("envelope" in result).toBe(true);
      if ("envelope" in result) {
        expect(result.envelope.status).toBe("approved");
        // The campaignId should be resolved
        expect(result.envelope.proposals[0]?.parameters["campaignId"]).toBe("camp_123");
      }
    });

    it("should propose directly when no entity refs", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const result = await orchestrator.resolveAndPropose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
        entityRefs: [],
      });

      expect("envelope" in result).toBe(true);
    });
  });

  describe("Full lifecycle", () => {
    it("should complete propose → approve → execute → undo → approve undo → execute undo", async () => {
      // Set medium risk so approval is needed
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      // Step 1: Propose
      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
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
      // Depending on the undo recipe's risk, it may or may not need approval.
      // In our test setup, the undo uses "ads.campaign.resume" which goes through
      // the same risk evaluation
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

      // Verify chain integrity
      const chainResult = await ledger.verifyChain(allEntries);
      expect(chainResult.valid).toBe(true);
    });
  });
});
