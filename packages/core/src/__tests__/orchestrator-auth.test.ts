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

  // Self-approval prevention tests have moved to platform-lifecycle.test.ts
  // (PlatformLifecycle is the sole approval owner)

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

  // Approval rate limiting and self-approval via patch tests have moved to
  // platform-lifecycle.test.ts (PlatformLifecycle is the sole approval owner)

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
