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

describe("LifecycleOrchestrator — proposePlan() with single_approval mode", () => {
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

    // Set up cartridge to return high base risk (triggers approval)
    cartridge.onRiskInput(() => ({
      baseRisk: "high" as const,
      exposure: { dollarsAtRisk: 500, blastRadius: 1 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));
  });

  it("should create one plan-level approval request in single_approval mode", async () => {
    const plan = {
      id: "plan_1",
      envelopeId: "",
      strategy: "atomic" as const,
      approvalMode: "single_approval" as const,
      summary: "Test plan",
      proposalOrder: [],
    };

    const proposals = [
      {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      },
      {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_2" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      },
    ];

    const result = await orchestrator.proposePlan(plan, proposals);

    expect(result.planApprovalRequest).toBeDefined();
    expect(result.planEnvelope).toBeDefined();
    expect(result.planEnvelope!.status).toBe("pending_approval");
    expect(result.planApprovalRequest!.summary).toContain("Plan");
    expect(result.planApprovalRequest!.summary).toContain("2 actions");

    for (const r of result.results) {
      expect(r.approvalRequest).toBeNull();
    }

    for (const r of result.results) {
      expect(r.envelope.status).toBe("queued");
    }
  });

  it("should not create plan approval when all proposals auto-allow", async () => {
    cartridge.onRiskInput(() => ({
      baseRisk: "low" as const,
      exposure: { dollarsAtRisk: 5, blastRadius: 1 },
      reversibility: "full" as const,
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    }));

    const plan = {
      id: "plan_2",
      envelopeId: "",
      strategy: "atomic" as const,
      approvalMode: "single_approval" as const,
      summary: "Low risk plan",
      proposalOrder: [],
    };

    const proposals = [
      {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      },
    ];

    const result = await orchestrator.proposePlan(plan, proposals);

    expect(result.planApprovalRequest).toBeUndefined();
    expect(result.planEnvelope).toBeUndefined();
    expect(result.planDecision).toBe("allow");
  });

  it("per_action mode should not create plan-level approval", async () => {
    const plan = {
      id: "plan_6",
      envelopeId: "",
      strategy: "atomic" as const,
      approvalMode: "per_action" as const,
      summary: "Per-action plan",
      proposalOrder: [],
    };

    const proposals = [
      {
        actionType: "digital-ads.campaign.pause",
        parameters: { campaignId: "camp_1" },
        principalId: "user_1",
        cartridgeId: "digital-ads",
      },
    ];

    const result = await orchestrator.proposePlan(plan, proposals);

    expect(result.planApprovalRequest).toBeUndefined();
    expect(result.planEnvelope).toBeUndefined();

    expect(result.results[0]?.approvalRequest).not.toBeNull();
    expect(result.results[0]?.envelope.status).toBe("pending_approval");
  });
});
