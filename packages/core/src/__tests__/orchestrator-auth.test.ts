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

describe("LifecycleOrchestrator — authorization guards", () => {
  let storage: StorageContext;
  let ledger: AuditLedger;
  let guardrailState: GuardrailState;
  let orchestrator: LifecycleOrchestrator;
  let cartridge: TestCartridge;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    const ledgerStorage = new InMemoryLedgerStorage();
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

  describe("Self-approval prevention (1.1)", () => {
    it("should reject when requester tries to approve their own proposal", async () => {
      makeHighRiskCartridge(cartridge);

      await storage.identity.savePrincipal({
        id: "user_1",
        type: "user",
        name: "User 1",
        organizationId: null,
        roles: ["requester", "approver"],
      });

      const routingConfig: ApprovalRoutingConfig = {
        defaultApprovers: ["user_1", "admin_1"],
        defaultFallbackApprover: null,
        defaultExpiryMs: 24 * 60 * 60 * 1000,
        defaultExpiredBehavior: "deny",
        elevatedExpiryMs: 12 * 60 * 60 * 1000,
        mandatoryExpiryMs: 4 * 60 * 60 * 1000,
        denyWhenNoApprovers: true,
      };

      const selfApprovalOrch = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig,
      });

      const proposeResult = await selfApprovalOrch.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      await expect(
        selfApprovalOrch.respondToApproval({
          approvalId: proposeResult.approvalRequest!.id,
          action: "approve",
          respondedBy: "user_1",
          bindingHash: proposeResult.approvalRequest!.bindingHash,
        }),
      ).rejects.toThrow("Self-approval is not permitted");
    });

    it("should allow approval from a different principal", async () => {
      makeHighRiskCartridge(cartridge);

      const proposeResult = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      const response = await orchestrator.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "admin_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
    });

    it("should allow self-approval when selfApprovalAllowed is true", async () => {
      makeHighRiskCartridge(cartridge);

      await storage.identity.savePrincipal({
        id: "user_1",
        type: "user",
        name: "User 1",
        organizationId: null,
        roles: ["requester", "approver"],
      });

      const selfApprovalOrch = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig: {
          defaultApprovers: ["user_1"],
          defaultFallbackApprover: null,
          defaultExpiryMs: 24 * 60 * 60 * 1000,
          defaultExpiredBehavior: "deny",
          elevatedExpiryMs: 12 * 60 * 60 * 1000,
          mandatoryExpiryMs: 4 * 60 * 60 * 1000,
          denyWhenNoApprovers: true,
        },
        selfApprovalAllowed: true,
      });

      const proposeResult = await selfApprovalOrch.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      const response = await selfApprovalOrch.respondToApproval({
        approvalId: proposeResult.approvalRequest!.id,
        action: "approve",
        respondedBy: "user_1",
        bindingHash: proposeResult.approvalRequest!.bindingHash,
      });

      expect(response.approvalState.status).toBe("approved");
    });
  });

  describe("Emergency override authorization (1.2)", () => {
    it("should reject emergencyOverride from non-admin principal", async () => {
      await storage.identity.savePrincipal({
        id: "user_1",
        type: "user",
        name: "User 1",
        organizationId: null,
        roles: ["requester"],
      });

      await expect(
        orchestrator.propose({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_1" },
          principalId: "user_1",
          cartridgeId: "digital-ads",
          emergencyOverride: true,
        }),
      ).rejects.toThrow("Emergency override requires admin or emergency_responder role");
    });

    it("should allow emergencyOverride from admin principal", async () => {
      await storage.identity.savePrincipal({
        id: "user_1",
        type: "user",
        name: "User 1",
        organizationId: null,
        roles: ["admin"],
      });

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
        emergencyOverride: true,
      });

      expect(result.envelope.status).toBe("approved");
      expect(result.governanceNote).toContain("emergency override");
    });

    it("should allow emergencyOverride from emergency_responder principal", async () => {
      await storage.identity.savePrincipal({
        id: "user_1",
        type: "user",
        name: "User 1",
        organizationId: null,
        roles: ["emergency_responder"],
      });

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
        emergencyOverride: true,
      });

      expect(result.envelope.status).toBe("approved");
    });
  });

  describe("Approval rate limiting (2.3)", () => {
    it("should reject when approval rate limit is exceeded", async () => {
      makeHighRiskCartridge(cartridge);

      const rateLimitedOrch = new LifecycleOrchestrator({
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
        approvalRateLimit: { maxApprovals: 3, windowMs: 60_000 },
      });

      for (let i = 0; i < 3; i++) {
        const proposeResult = await rateLimitedOrch.propose({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: `camp_${i}` },
          principalId: "user_1",
          cartridgeId: "digital-ads",
        });

        await rateLimitedOrch.respondToApproval({
          approvalId: proposeResult.approvalRequest!.id,
          action: "approve",
          respondedBy: "admin_1",
          bindingHash: proposeResult.approvalRequest!.bindingHash,
        });
      }

      const proposeResult = await rateLimitedOrch.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_4" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await expect(
        rateLimitedOrch.respondToApproval({
          approvalId: proposeResult.approvalRequest!.id,
          action: "approve",
          respondedBy: "admin_1",
          bindingHash: proposeResult.approvalRequest!.bindingHash,
        }),
      ).rejects.toThrow("Approval rate limit exceeded");
    });
  });

  describe("Self-approval via patch prevention (#2)", () => {
    it("should reject self-approval via patch action", async () => {
      makeHighRiskCartridge(cartridge);

      await storage.identity.savePrincipal({
        id: "user_1",
        name: "Test User",
        type: "user",
        roles: ["operator"],
        organizationId: null,
      });

      const patchOrch = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        routingConfig: {
          defaultApprovers: ["user_1", "admin_1"],
          defaultFallbackApprover: null,
          defaultExpiryMs: 24 * 60 * 60 * 1000,
          defaultExpiredBehavior: "deny",
          elevatedExpiryMs: 12 * 60 * 60 * 1000,
          mandatoryExpiryMs: 4 * 60 * 60 * 1000,
          denyWhenNoApprovers: true,
        },
        selfApprovalAllowed: false,
      });

      const proposeResult = await patchOrch.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(proposeResult.approvalRequest).not.toBeNull();

      await expect(
        patchOrch.respondToApproval({
          approvalId: proposeResult.approvalRequest!.id,
          action: "patch",
          respondedBy: "user_1",
          bindingHash: proposeResult.approvalRequest!.bindingHash,
          patchValue: { campaignId: "camp_2" },
        }),
      ).rejects.toThrow("Self-approval is not permitted");
    });
  });

  describe("Structured denial for action type restriction (#13)", () => {
    it("should return structured ProposeResult instead of throwing", async () => {
      const { InMemoryGovernanceProfileStore } = await import("../governance/profile.js");
      const profileStore = new InMemoryGovernanceProfileStore();
      await profileStore.setConfig("org_restricted", {
        profile: "strict",
        blockedActionTypes: ["digital-ads.campaign.delete"],
      });

      const restrictedOrch = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        governanceProfileStore: profileStore,
      });

      const result = await restrictedOrch.propose({
        actionType: "digital-ads.campaign.delete",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
        organizationId: "org_restricted",
      });

      expect(result.denied).toBe(true);
      expect(result.envelope.status).toBe("denied");
    });
  });
});
