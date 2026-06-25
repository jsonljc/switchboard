/**
 * adoptimizer.campaign.reset_prior_budget, exercised through the REAL GovernanceGate + policy engine.
 * Proves the automated-rollback gate:
 *   - the seeded ALLOW-ONLY policy + seeded system principal -> EXECUTE (no park, no human). This is
 *     the load-bearing difference from the forward reallocate gate (which parks at mandatory): the
 *     rollback is a safety reversal that must auto-execute.
 *   - it EXECUTES even under an autonomous deployment (allow path; no spend lever needed),
 *   - an un-seeded org -> default-DENY (fail safe),
 *   - the anchored reset rule does NOT bleed onto the reallocate or pause intents.
 * Uses the SAME db seed builder production provisioning uses + the REAL submit-request builder, so the
 * gate, the seed, and the producer cannot drift.
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import { buildRileyResetBudgetAllowPolicyInput } from "@switchboard/db";
import {
  RILEY_RESET_PRIOR_BUDGET_INTENT,
  buildRileyResetBudgetSubmitRequest,
} from "../services/workflows/riley-reset-budget-submit-request.js";

const ORG = "org-acme";

function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function allowPolicy(): Policy {
  return {
    ...buildRileyResetBudgetAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function resetParameters(): Record<string, unknown> {
  const req = buildRileyResetBudgetSubmitRequest({
    organizationId: ORG,
    deploymentId: "dep-riley",
    adAccountId: "act_123",
    campaignId: "camp_1",
    targetCents: 5000,
    rollbackOfWorkUnitId: "wu_forward_1",
    breachMetric: "account_booked_conversions_drop_share",
    breachReason: "exceeded",
  });
  if (!req) throw new Error("expected a non-null reset submit request");
  return req.parameters as Record<string, unknown>;
}

function resetWorkUnit(opts?: { trustLevelOverride?: "autonomous" }): WorkUnit {
  return {
    id: "wu-reset-1",
    requestedAt: "2026-06-25T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: RILEY_RESET_PRIOR_BUDGET_INTENT,
    parameters: resetParameters(),
    // The reset resolves PLATFORM_DIRECT; the gate sees a supervised context. Org-isolation +
    // structural bound live in the executor, not here.
    deployment: {
      deploymentId: "platform-direct",
      skillSlug: "adoptimizer",
      trustLevel: "supervised",
      trustScore: 0,
      ...(opts?.trustLevelOverride ? { trustLevelOverride: opts.trustLevelOverride } : {}),
    },
    resolvedMode: "workflow",
    traceId: "trace-reset-1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function resetRegistration(): IntentRegistration {
  return {
    intent: RILEY_RESET_PRIOR_BUDGET_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: RILEY_RESET_PRIOR_BUDGET_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

describe("adoptimizer.campaign.reset_prior_budget governance gate (real engine)", () => {
  it("EXECUTES with the seeded allow-only policy (the rollback auto-executes, no human)", async () => {
    const gate = buildGate([allowPolicy()]);
    const decision = await gate.evaluate(resetWorkUnit(), resetRegistration());
    expect(decision.outcome).toBe("execute");
  });

  it("STILL executes under an autonomous deployment (allow path, no spend lever needed)", async () => {
    const gate = buildGate([allowPolicy()]);
    const decision = await gate.evaluate(
      resetWorkUnit({ trustLevelOverride: "autonomous" }),
      resetRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });

  it("carries NO spendAmount in its parameters (a restore is not an outbound spend decision)", () => {
    expect("spendAmount" in resetParameters()).toBe(false);
  });

  it("an un-seeded org default-DENIES the reset (fail safe)", async () => {
    const gate = buildGate([]);
    const decision = await gate.evaluate(resetWorkUnit(), resetRegistration());
    expect(decision.outcome).not.toBe("execute");
  });

  it("the anchored reset rule does NOT bleed onto the reallocate or pause intents", () => {
    const value = buildRileyResetBudgetAllowPolicyInput(ORG).rule.conditions[0]!.value;
    const re = new RegExp(value);
    expect(re.test("adoptimizer.campaign.reset_prior_budget")).toBe(true);
    expect(re.test("adoptimizer.campaign.reallocate")).toBe(false);
    expect(re.test("adoptimizer.campaign.pause")).toBe(false);
  });
});
