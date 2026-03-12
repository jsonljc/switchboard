import { describe, it, expect, beforeEach } from "vitest";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import { InMemoryGuardrailStateStore } from "../guardrail-state/in-memory.js";
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

describe("LifecycleOrchestrator — guardrails", () => {
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

    orchestrator = new LifecycleOrchestrator({
      storage,
      ledger,
      guardrailState,
    });
  });

  describe("Guardrail state mutations", () => {
    it("should increment rate limit counters after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 10, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await orchestrator.executeApproved(result.envelope.id);

      const scopeKey = "user:digital-ads.campaign.pause";
      const entry = guardrailState.actionCounts.get(scopeKey);
      expect(entry).toBeDefined();
      expect(entry!.count).toBe(1);
    });

    it("should set cooldown timestamp after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [],
        cooldowns: [
          { actionType: "digital-ads.campaign.pause", cooldownMs: 60_000, scope: "entity" },
        ],
        protectedEntities: [],
      });

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await orchestrator.executeApproved(result.envelope.id);

      const entityKey = "entity:ent_1";
      const lastTime = guardrailState.lastActionTimes.get(entityKey);
      expect(lastTime).toBeDefined();
      expect(lastTime).toBeGreaterThan(0);
    });

    it("should deny when rate limit is exceeded", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 2, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      for (let i = 0; i < 2; i++) {
        const result = await orchestrator.propose({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: `camp_${i}` },
          principalId: "user_1",
          cartridgeId: "digital-ads",
        });
        await orchestrator.executeApproved(result.envelope.id);
      }

      const denied = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_3" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
    });

    it("should deny when cooldown is active", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      cartridge.onGuardrails({
        rateLimits: [],
        cooldowns: [
          { actionType: "digital-ads.campaign.pause", cooldownMs: 60_000, scope: "entity" },
        ],
        protectedEntities: [],
      });

      const result = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });
      await orchestrator.executeApproved(result.envelope.id);

      const denied = await orchestrator.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
    });
  });

  describe("Guardrail state persistence", () => {
    it("should persist rate limit counts to store after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
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
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await persistOrch.executeApproved(result.envelope.id);

      const stored = await stateStore.getRateLimits(["user:digital-ads.campaign.pause"]);
      expect(stored.size).toBe(1);
      expect(stored.get("user:digital-ads.campaign.pause")?.count).toBe(1);
    });

    it("should persist cooldown timestamps to store after execution", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
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
        cooldowns: [
          { actionType: "digital-ads.campaign.pause", cooldownMs: 60_000, scope: "entity" },
        ],
        protectedEntities: [],
      });

      const result = await persistOrch.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1", entityId: "ent_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      await persistOrch.executeApproved(result.envelope.id);

      const stored = await stateStore.getCooldowns(["entity:ent_1"]);
      expect(stored.size).toBe(1);
      expect(stored.get("entity:ent_1")).toBeGreaterThan(0);
    });

    it("should hydrate state — new orchestrator instance sees prior counts", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const stateStore = new InMemoryGuardrailStateStore();

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 10, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      const orch1 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      const result = await orch1.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });
      await orch1.executeApproved(result.envelope.id);

      const freshGuardrailState = createGuardrailState();
      const orch2 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: freshGuardrailState,
        guardrailStateStore: stateStore,
      });

      const result2 = await orch2.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_2" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(result2.denied).toBe(false);
      expect(freshGuardrailState.actionCounts.get("user:digital-ads.campaign.pause")?.count).toBe(
        1,
      );
    });

    it("should deny rate-limited action across orchestrator restarts", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ trustBehaviors: ["digital-ads.campaign.pause"] }),
      );

      const stateStore = new InMemoryGuardrailStateStore();

      cartridge.onGuardrails({
        rateLimits: [{ scope: "user", maxActions: 2, windowMs: 60_000 }],
        cooldowns: [],
        protectedEntities: [],
      });

      const orch1 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      for (let i = 0; i < 2; i++) {
        const result = await orch1.propose({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: `camp_${i}` },
          principalId: "user_1",
          cartridgeId: "digital-ads",
        });
        await orch1.executeApproved(result.envelope.id);
      }

      const orch2 = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState: createGuardrailState(),
        guardrailStateStore: stateStore,
      });

      const denied = await orch2.propose({
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_3" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      });

      expect(denied.denied).toBe(true);
      expect(denied.envelope.status).toBe("denied");
    });
  });
});
