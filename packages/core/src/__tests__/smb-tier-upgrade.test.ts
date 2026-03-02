import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryTierStore } from "../smb/tier-resolver.js";
import { SmbActivityLog, InMemorySmbActivityLogStorage } from "../smb/activity-log.js";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec, SmbOrgConfig } from "@switchboard/schemas";
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

describe("TierStore & Orchestrator Tier Routing", () => {
  let storage: StorageContext;
  let ledger: AuditLedger;
  let guardrailState: GuardrailState;
  let tierStore: InMemoryTierStore;
  let smbActivityLog: SmbActivityLog;
  let activityStorage: InMemorySmbActivityLogStorage;
  let cartridge: TestCartridge;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    const ledgerStorage = new InMemoryLedgerStorage();
    ledger = new AuditLedger(ledgerStorage);
    guardrailState = createGuardrailState();
    tierStore = new InMemoryTierStore();
    activityStorage = new InMemorySmbActivityLogStorage();
    smbActivityLog = new SmbActivityLog(activityStorage);

    cartridge = new TestCartridge(createTestManifest({ id: "digital-ads" }));
    cartridge.onExecute((_actionType, params) => ({
      success: true,
      summary: `Executed ${_actionType}`,
      externalRefs: {},
      rollbackAvailable: true,
      partialFailures: [],
      durationMs: 15,
      undoRecipe: null,
    }));
    storage.cartridges.register("digital-ads", cartridge);

    // Seed policy (needed for enterprise pipeline)
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

    // Seed identity (needed for enterprise pipeline)
    await storage.identity.saveSpec(makeIdentitySpec());
    await storage.identity.savePrincipal({
      id: "user_1",
      type: "user",
      name: "Test User",
      organizationId: null,
      roles: [],
    });
    await storage.identity.savePrincipal({
      id: "admin_1",
      type: "user",
      name: "Admin",
      organizationId: null,
      roles: ["approver"],
    });
  });

  describe("InMemoryTierStore", () => {
    it("should default to smb tier", async () => {
      const tier = await tierStore.getTier("org_1");
      expect(tier).toBe("smb");
    });

    it("should store and retrieve SMB config", async () => {
      const config: SmbOrgConfig = {
        tier: "smb",
        governanceProfile: "guarded",
        perActionSpendLimit: 500,
        dailySpendLimit: 2000,
        ownerId: "owner_1",
      };

      await tierStore.setSmbConfig("org_1", config);
      const retrieved = await tierStore.getSmbConfig("org_1");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.ownerId).toBe("owner_1");
      expect(retrieved!.perActionSpendLimit).toBe(500);
    });

    it("should return null SMB config for enterprise orgs", async () => {
      await tierStore.upgradeTier("org_1", "enterprise");
      const config = await tierStore.getSmbConfig("org_1");
      expect(config).toBeNull();
    });

    it("should upgrade to enterprise", async () => {
      await tierStore.setSmbConfig("org_1", {
        tier: "smb",
        governanceProfile: "guarded",
        perActionSpendLimit: null,
        dailySpendLimit: null,
        ownerId: "owner_1",
      });

      await tierStore.upgradeTier("org_1", "enterprise");
      const tier = await tierStore.getTier("org_1");
      expect(tier).toBe("enterprise");
    });
  });

  describe("Orchestrator Tier Routing", () => {
    it("should route SMB org through SMB pipeline", async () => {
      const smbConfig: SmbOrgConfig = {
        tier: "smb",
        governanceProfile: "guarded",
        perActionSpendLimit: null,
        dailySpendLimit: null,
        ownerId: "owner_1",
      };
      await tierStore.setSmbConfig("org_smb", smbConfig);

      const orchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        tierStore,
        smbActivityLog,
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

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_smb",
        cartridgeId: "digital-ads",
      });

      // SMB with guarded profile and no amount = low risk = auto-approve
      expect(result.denied).toBe(false);
      expect(result.envelope.status).toBe("approved");

      // Activity log should have an entry (SMB pipeline)
      const entries = await smbActivityLog.query({ organizationId: "org_smb" });
      expect(entries).toHaveLength(1);
    });

    it("should route enterprise org through enterprise pipeline", async () => {
      tierStore.setTier("org_enterprise", "enterprise");

      const orchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        tierStore,
        smbActivityLog,
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

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_enterprise",
        cartridgeId: "digital-ads",
      });

      // Enterprise pipeline runs (no SMB activity log entry)
      expect(result.envelope).toBeDefined();
      const entries = await smbActivityLog.query({ organizationId: "org_enterprise" });
      expect(entries).toHaveLength(0);
    });

    it("should switch to enterprise pipeline after upgrade", async () => {
      const smbConfig: SmbOrgConfig = {
        tier: "smb",
        governanceProfile: "guarded",
        perActionSpendLimit: null,
        dailySpendLimit: null,
        ownerId: "owner_1",
      };
      await tierStore.setSmbConfig("org_upgrade", smbConfig);

      const orchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
        tierStore,
        smbActivityLog,
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

      // First call goes through SMB pipeline
      const result1 = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_upgrade",
        cartridgeId: "digital-ads",
      });
      expect(result1.envelope.status).toBe("approved");
      const smbEntries = await smbActivityLog.query({ organizationId: "org_upgrade" });
      expect(smbEntries).toHaveLength(1);

      // Upgrade
      await tierStore.upgradeTier("org_upgrade", "enterprise");

      // Second call goes through enterprise pipeline
      const result2 = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: {},
        principalId: "user_1",
        organizationId: "org_upgrade",
        cartridgeId: "digital-ads",
      });
      expect(result2.envelope).toBeDefined();

      // SMB activity log should still only have 1 entry (the first one)
      const smbEntries2 = await smbActivityLog.query({ organizationId: "org_upgrade" });
      expect(smbEntries2).toHaveLength(1);
    });
  });
});
