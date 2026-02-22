import { describe, it, expect, beforeEach } from "vitest";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import { CompetenceTracker } from "../competence/index.js";
import { InMemoryGuardrailStateStore } from "../guardrail-state/in-memory.js";
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

  describe("Guardrail state mutations", () => {
    it("should increment rate limit counters after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 10, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await orchestrator.executeApproved(result.envelope.id);

      const scopeKey = "user:ads.campaign.pause";
      const entry = guardrailState.actionCounts.get(scopeKey);
      expect(entry).toBeDefined();
      expect(entry!.count).toBe(1);
    });

    it("should set cooldown timestamp after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [],
        cooldowns: [{ actionType: "ads.campaign.pause", cooldownMs: 60_000, scope: "entity" }],
        protectedEntities: [],
      });

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await orchestrator.executeApproved(result.envelope.id);

      const entityKey = "entity:ent_1";
      const lastTime = guardrailState.lastActionTimes.get(entityKey);
      expect(lastTime).toBeDefined();
      expect(lastTime).toBeGreaterThan(0);
    });

    it("should deny when rate limit is exceeded", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 2, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      // Execute twice to fill the rate limit
      for (let i = 0; i < 2; i++) {
        const result = await orchestrator.propose({
          actionType: "ads.campaign.pause",
          parameters: { campaignId: `camp_${i}` },
          principalId: "user_1",
          cartridgeId: "ads-spend",
        });
        await orchestrator.executeApproved(result.envelope.id);
      }

      // Third proposal should be denied
      const denied = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_3" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
    });

    it("should deny when cooldown is active", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [],
        cooldowns: [{ actionType: "ads.campaign.pause", cooldownMs: 60_000, scope: "entity" }],
        protectedEntities: [],
      });

      // Execute once
      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });
      await orchestrator.executeApproved(result.envelope.id);

      // Second proposal for same entity should be denied due to cooldown
      const denied = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
    });
  });

  describe("Guardrail state persistence", () => {
    it("should persist rate limit counts to store after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const stateStore = new InMemoryGuardrailStateStore();
      const persistOrch = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 10, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      const result = await persistOrch.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await persistOrch.executeApproved(result.envelope.id);

      // Verify the store has the entry
      const stored = await stateStore.getRateLimits(["user:ads.campaign.pause"]);
      expect(stored.size).toBe(1);
      expect(stored.get("user:ads.campaign.pause")?.count).toBe(1);
    });

    it("should persist cooldown timestamps to store after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const stateStore = new InMemoryGuardrailStateStore();
      const persistOrch = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      cartridge.onGuardrails({
        rateLimits: [],
        cooldowns: [{ actionType: "ads.campaign.pause", cooldownMs: 60_000, scope: "entity" }],
        protectedEntities: [],
      });

      const result = await persistOrch.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      await persistOrch.executeApproved(result.envelope.id);

      const stored = await stateStore.getCooldowns(["entity:ent_1"]);
      expect(stored.size).toBe(1);
      expect(stored.get("entity:ent_1")).toBeGreaterThan(0);
    });

    it("should hydrate state — new orchestrator instance sees prior counts", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const stateStore = new InMemoryGuardrailStateStore();

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 10, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      // First orchestrator: execute an action
      const orch1 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      const result = await orch1.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });
      await orch1.executeApproved(result.envelope.id);

      // Second orchestrator: fresh guardrailState, same store
      const freshGuardrailState = createGuardrailState();
      const orch2 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: freshGuardrailState,
        guardrailStateStore: stateStore,
      });

      // Propose triggers hydration — the rate limit count should be visible
      const result2 = await orch2.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_2" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // The action should succeed (not denied) but the count should reflect prior execution
      expect(result2.denied).toBe(false);
      // After hydration, the in-memory state should have the prior count
      expect(freshGuardrailState.actionCounts.get("user:ads.campaign.pause")?.count).toBe(1);
    });

    it("should deny rate-limited action across orchestrator restarts", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["ads.campaign.pause"] }),
      );

      const stateStore = new InMemoryGuardrailStateStore();

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 2, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      // First orchestrator: fill up rate limit
      const orch1 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      for (let i = 0; i < 2; i++) {
        const result = await orch1.propose({
          actionType: "ads.campaign.pause",
          parameters: { campaignId: `camp_${i}` },
          principalId: "user_1",
          cartridgeId: "ads-spend",
        });
        await orch1.executeApproved(result.envelope.id);
      }

      // Second orchestrator: should deny due to persisted rate limit
      const orch2 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      const denied = await orch2.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_3" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
    });
  });

  describe("Approver authorization", () => {
    it("should reject approval from unauthorized principal", async () => {
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
      };

      const authOrchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig,
      });

      // Seed admin_1 as an approver principal
      await storage.identity.savePrincipal({
        id: "admin_1",
        type: "user",
        name: "Admin",
        organizationId: null,
        roles: ["approver"],
      });

      const proposeResult = await authOrchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      // Attempt approval from "hacker" (non-existent principal)
      await expect(
        authOrchestrator.respondToApproval({
          approvalId: proposeResult.approvalRequest!.id,
          action: "approve",
          respondedBy: "hacker",
          bindingHash: proposeResult.approvalRequest!.bindingHash,
        }),
      ).rejects.toThrow("Principal not found: hacker");
    });

    it("should allow approval from authorized principal", async () => {
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
      };

      const authOrchestrator = new LifecycleOrchestrator({
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

      const proposeResult = await authOrchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      const response = await authOrchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
      expect(response.executionResult?.success).toBe(true);
    });

    it("should allow delegated approval", async () => {
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
      };

      const authOrchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig,
      });

      // Seed both principals
      await storage.identity.savePrincipal({
        id: "admin_1",
        type: "user",
        name: "Admin",
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

      // Create delegation rule from admin_1 to delegate_1
      await storage.identity.saveDelegationRule({
        id: "deleg_1",
        grantor: "admin_1",
        grantee: "delegate_1",
        scope: "*",
        expiresAt: null,
      });

      const proposeResult = await authOrchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Approve as delegate
      const response = await authOrchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "delegate_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
      expect(response.executionResult?.success).toBe(true);
    });

    it("should skip authorization when no approvers configured", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      // Use default routing config (empty approvers)
      const proposeResult = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      // Approve as anyone — no principal seeded, but should succeed
      const response = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "anyone",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
      expect(response.executionResult?.success).toBe(true);
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

    it("should earn trust through successful executions → eventually auto-approved", async () => {
      // Action starts as NOT trusted — needs approval (medium risk)
      cartridge.onRiskInput(() => ({
        baseRisk: "medium" as const,
        exposure: { dollarsAtRisk: 100, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      // Simulate enough successes to earn trust (score >= 80 + >= 10 successes)
      for (let i = 0; i < 25; i++) {
        await competenceTracker.recordSuccess("user_1", "ads.campaign.pause");
      }

      // Now propose — should be auto-approved because competence adds to trust behaviors
      const result = await competenceOrchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Agent has earned trust, so action should be approved without manual approval
      expect(result.envelope.status).toBe("approved");
      expect(result.decisionTrace.approvalRequired).toBe("none");

      // Check COMPETENCE_TRUST trace is present
      const competenceCheck = result.decisionTrace.checks.find(
        (c) => c.checkCode === "COMPETENCE_TRUST",
      );
      expect(competenceCheck).toBeDefined();
      expect(competenceCheck!.checkData["shouldTrust"]).toBe(true);
    });

    it("should reduce competence on failed execution", async () => {
      // Build up trust
      for (let i = 0; i < 25; i++) {
        await competenceTracker.recordSuccess("user_1", "ads.campaign.pause");
      }

      // Verify trusted
      const adj1 = await competenceTracker.getAdjustment("user_1", "ads.campaign.pause");
      expect(adj1!.shouldTrust).toBe(true);
      const scoreBeforeFailures = adj1!.score;

      // Record multiple failures to lose trust
      for (let i = 0; i < 5; i++) {
        await competenceTracker.recordFailure("user_1", "ads.campaign.pause");
      }

      const adj2 = await competenceTracker.getAdjustment("user_1", "ads.campaign.pause");
      expect(adj2!.score).toBeLessThan(scoreBeforeFailures);
      expect(adj2!.shouldTrust).toBe(false);
    });

    it("should record rollback against original action type on undo", async () => {
      // Build up some competence
      for (let i = 0; i < 5; i++) {
        await competenceTracker.recordSuccess("user_1", "ads.campaign.pause");
      }

      const adjBefore = await competenceTracker.getAdjustment("user_1", "ads.campaign.pause");

      // Execute an action
      const result = await competenceOrchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Execute it
      await competenceOrchestrator.executeApproved(result.envelope.id);

      // Now undo
      await competenceOrchestrator.requestUndo(result.envelope.id);

      // The rollback should have been recorded against the original action type
      const adjAfter = await competenceTracker.getAdjustment("user_1", "ads.campaign.pause");
      // Score should have gone up from the execution success (+3 + streak), then down from rollback (-15)
      // Net change from adjBefore: +success points + streak bonus - 15
      expect(adjAfter!.record.rollbackCount).toBe(1);
      expect(adjAfter!.score).toBeLessThan(adjBefore!.score + 10); // The rollback penalty should dominate
    });

    it("should work without competenceTracker (backward compat)", async () => {
      // Use the original orchestrator (no competence tracker)
      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(result.denied).toBe(false);
      expect(result.envelope).toBeDefined();
      // No COMPETENCE_TRUST check
      const competenceCheck = result.decisionTrace.checks.find(
        (c) => c.checkCode === "COMPETENCE_TRUST",
      );
      expect(competenceCheck).toBeUndefined();
    });
  });
});
