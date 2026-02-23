import { describe, it, expect, beforeEach } from "vitest";
import { resolveIdentity } from "../identity/spec.js";
import { LifecycleOrchestrator } from "../orchestrator/lifecycle.js";
import { createInMemoryStorage } from "../storage/index.js";
import { AuditLedger, InMemoryLedgerStorage } from "../audit/ledger.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";
import type { IdentitySpec, RoleOverlay } from "@switchboard/schemas";
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

function makeOverlay(overrides: Partial<RoleOverlay> = {}): RoleOverlay {
  return {
    id: "overlay-1",
    identitySpecId: "spec_test",
    name: "Test Overlay",
    description: "A test overlay",
    mode: "restrict",
    priority: 0,
    active: true,
    conditions: {},
    overrides: {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

describe("Governance Profiles", () => {
  describe("resolveIdentity() with governance profiles", () => {
    it("observe profile: all risk tolerances are 'none'", () => {
      const spec = makeIdentitySpec({ governanceProfile: "observe" });
      const result = resolveIdentity(spec, [], {});
      expect(result.effectiveRiskTolerance).toEqual({
        none: "none",
        low: "none",
        medium: "none",
        high: "none",
        critical: "none",
      });
      expect(result.governanceProfile).toBe("observe");
    });

    it("strict profile: elevated thresholds", () => {
      const spec = makeIdentitySpec({ governanceProfile: "strict" });
      const result = resolveIdentity(spec, [], {});
      expect(result.effectiveRiskTolerance).toEqual({
        none: "none",
        low: "standard",
        medium: "elevated",
        high: "mandatory",
        critical: "mandatory",
      });
      expect(result.effectiveSpendLimits.perAction).toBe(1000);
      expect(result.effectiveSpendLimits.daily).toBe(5000);
    });

    it("locked profile: all mandatory", () => {
      const spec = makeIdentitySpec({ governanceProfile: "locked" });
      const result = resolveIdentity(spec, [], {});
      expect(result.effectiveRiskTolerance).toEqual({
        none: "mandatory",
        low: "mandatory",
        medium: "mandatory",
        high: "mandatory",
        critical: "mandatory",
      });
      expect(result.effectiveSpendLimits.perAction).toBe(0);
    });

    it("guarded profile matches current default behavior", () => {
      const spec = makeIdentitySpec({ governanceProfile: "guarded" });
      const result = resolveIdentity(spec, [], {});
      expect(result.effectiveRiskTolerance).toEqual({
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      });
    });

    it("profile + overlay stacking: overlay restricts on top of profile", () => {
      const spec = makeIdentitySpec({ governanceProfile: "guarded" });
      const overlay = makeOverlay({
        mode: "restrict",
        overrides: {
          riskTolerance: {
            none: "none",
            low: "standard",
            medium: "elevated",
            high: "mandatory",
            critical: "mandatory",
          },
        },
      });
      const result = resolveIdentity(spec, [overlay], {});
      // The overlay should make things more restrictive than the guarded defaults
      expect(result.effectiveRiskTolerance.low).toBe("standard");
      expect(result.effectiveRiskTolerance.medium).toBe("elevated");
      expect(result.effectiveRiskTolerance.high).toBe("mandatory");
    });

    it("no governanceProfile still parses (backward compat)", () => {
      const spec = makeIdentitySpec(); // no governanceProfile
      const result = resolveIdentity(spec, [], {});
      expect(result.governanceProfile).toBeUndefined();
      // Should use spec's own riskTolerance
      expect(result.effectiveRiskTolerance).toEqual(spec.riskTolerance);
    });
  });

  describe("Orchestrator with governance profiles", () => {
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
        undoRecipe: null,
      }));

      storage.cartridges.register("ads-spend", cartridge);

      orchestrator = new LifecycleOrchestrator({
        storage,
        ledger,
        guardrailState,
      });
    });

    it("observe mode still records full decision trace but auto-approves", async () => {
      // Set up a forbidden behavior that would normally deny
      await storage.identity.saveSpec(
        makeIdentitySpec({
          governanceProfile: "observe",
          forbiddenBehaviors: ["ads.campaign.pause"],
        }),
      );

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Observe mode auto-approves even for forbidden behaviors
      expect(result.envelope.status).toBe("approved");
      // But the decision trace still shows what WOULD have happened
      expect(result.decisionTrace.finalDecision).toBe("deny");
    });

    it("observe mode auto-approves even when approval would be required", async () => {
      cartridge.onRiskInput(() => ({
        baseRisk: "high" as const,
        exposure: { dollarsAtRisk: 500, blastRadius: 1 },
        reversibility: "full" as const,
        sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
      }));

      await storage.identity.saveSpec(
        makeIdentitySpec({ governanceProfile: "observe" }),
      );

      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      // Observe: auto-approved even though risk is high
      expect(result.envelope.status).toBe("approved");
      expect(result.approvalRequest).toBeNull();
    });

    it("locked mode requires mandatory approval for all risk levels", async () => {
      await storage.identity.saveSpec(
        makeIdentitySpec({ governanceProfile: "locked" }),
      );

      // Low-risk action should still require approval in locked mode
      const result = await orchestrator.propose({
        actionType: "ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "ads-spend",
      });

      expect(result.envelope.status).toBe("pending_approval");
      expect(result.approvalRequest).not.toBeNull();
    });
  });
});
