import { describe, it, expect, beforeEach } from "vitest";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
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

function makeHighRiskCartridge(cartridge: TestCartridge): void {
  cartridge.onRiskInput(() => ({
    baseRisk: "high" as const,
    exposure: { dollarsAtRisk: 500, blastRadius: 1 },
    reversibility: "full" as const,
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }));
}

describe("LifecycleOrchestrator — approval flows", () => {
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

  describe("respondToApproval()", () => {
    it("should approve and execute", async () => {
      makeHighRiskCartridge(cartridge);

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
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

      const allEntries = ledgerStorage.getAll();
      const executingEntry = allEntries.find((e) => e.eventType === "action.executing");
      const executedEntry = allEntries.find((e) => e.eventType === "action.executed");
      expect(executingEntry).toBeDefined();
      expect(executedEntry).toBeDefined();
      const executingIdx = allEntries.indexOf(executingEntry!);
      const executedIdx = allEntries.indexOf(executedEntry!);
      expect(executingIdx).toBeLessThan(executedIdx);
    });

    it("should reject and set status denied", async () => {
      makeHighRiskCartridge(cartridge);

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
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
      makeHighRiskCartridge(cartridge);

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
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

    it("should reject patch that violates policy", async () => {
      makeHighRiskCartridge(cartridge);

      await storage.identity.saveSpec(
        makeIdentitySpec({
          forbiddenBehaviors: ["digital-ads.campaign.pause"],
          riskTolerance: {
            none: "none",
            low: "none",
            medium: "none",
            high: "none",
            critical: "none",
          },
        }),
      );

      await storage.identity.saveSpec(makeIdentitySpec());

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      await storage.identity.saveSpec(
        makeIdentitySpec({
          forbiddenBehaviors: ["digital-ads.campaign.pause"],
        }),
      );

      const response = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "patch",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
        patchValue: { campaignId: "camp_2" },
      });

      expect(response.envelope.status).toBe("denied");
      expect(response.executionResult).toBeNull();
    });

    it("should handle expired approval", async () => {
      makeHighRiskCartridge(cartridge);

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

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

      const allEntries = ledgerStorage.getAll();
      const expiredEntry = allEntries.find((e) => e.eventType === "action.expired");
      expect(expiredEntry).toBeDefined();
      const snapshotId = String(expiredEntry?.snapshot["approvalId"] ?? "");
      const expectedId = proposeResult.approvalRequest!.id;
      expect(snapshotId.startsWith("appr_")).toBe(true);
      expect(snapshotId).toHaveLength(expectedId.length);
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
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(proposeResult.envelope.status).toBe("approved");

      const execResult = await orchestrator.executeApproved(proposeResult.envelope.id);
      expect(execResult.success).toBe(true);
      expect(execResult.undoRecipe).not.toBeNull();

      const updated = await storage.envelopes.getById(proposeResult.envelope.id);
      expect(updated?.status).toBe("executed");
    });

    it("should fail for non-approved envelope", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ forbiddenBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await expect(orchestrator.executeApproved(proposeResult.envelope.id)).rejects.toThrow(
        'envelope status is denied, expected "approved"',
      );
    });
  });

  describe("Approver authorization", () => {
    it("should reject approval from unauthorized principal", async () => {
      makeHighRiskCartridge(cartridge);

      const routingConfig: ApprovalRoutingConfig = {
        defaultApprovers: ["admin_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny",
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
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
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

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
      makeHighRiskCartridge(cartridge);

      const routingConfig: ApprovalRoutingConfig = {
        defaultApprovers: ["admin_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny",
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
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
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
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
      makeHighRiskCartridge(cartridge);

      const routingConfig: ApprovalRoutingConfig = {
        defaultApprovers: ["admin_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny",
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
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

      await storage.identity.savePrincipal({
        id: "delegate_1",
        type: "user",
        name: "Delegate",
        organizationId: null,
        roles: ["approver"],
      });

      await storage.identity.saveDelegationRule({
        id: "deleg_1",
        grantor: "admin_1",
        grantee: "delegate_1",
        scope: "*",
        expiresAt: null,
      });

      const proposeResult = await authOrchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      const response = await authOrchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "delegate_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
      expect(response.executionResult?.success).toBe(true);
    });

    it("should deny when no approvers configured (denyWhenNoApprovers)", async () => {
      makeHighRiskCartridge(cartridge);

      const noApproverOrchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig: {
          defaultApprovers: [],
          defaultFallbackApprover: null,
          defaultExpiryMs: 24 * 60 * 60 * 1000,
          defaultExpiredBehavior: "deny",
          elevatedExpiryMs: 12 * 60 * 60 * 1000,
          mandatoryExpiryMs: 4 * 60 * 60 * 1000,
          denyWhenNoApprovers: true,
        },
      });

      const proposeResult = await noApproverOrchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      // The policy engine allows the action (denied reflects policy decision),
      // but the approval router denies it because no approvers are configured.
      expect(proposeResult.envelope.status).toBe("denied");
      expect(proposeResult.approvalRequest).toBeNull();
    });
  });
});
