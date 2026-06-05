/**
 * adoptimizer.recommendation.handoff, exercised through the REAL GovernanceGate +
 * policy engine (NOT a spy ingress). Proves the Riley->agent handoff gate:
 *
 *   - WITH the seeded allow + require_approval(mandatory) policies AND the seeded
 *     system principal -> parks at MANDATORY (NOT system_auto_approved),
 *   - an un-seeded org default-DENIES (fail safe),
 *   - a bespoke (un-seeded) system principal id hard-denies (the cross-agent bite),
 *   - the anchored handoff rule does NOT bleed onto creative.job.continue.
 *
 * Mirrors creative-publish-gate.test.ts (the proven real-gate harness).
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
  buildRecommendationHandoffApprovalPolicyInput,
} from "@switchboard/db";

const ORG = "org-acme";

/** The seeded system principal's IdentitySpec (id "system" -> the "default" spec). */
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
    id: "policy_allow_handoff",
    name: "Allow handoff",
    description: "allow",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: RECOMMENDATION_HANDOFF_ALLOW_POLICY_RULE,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function approvalPolicy(): Policy {
  const p = buildRecommendationHandoffApprovalPolicyInput(ORG);
  return {
    ...p,
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function handoffWorkUnit(actorId = "system"): WorkUnit {
  return {
    id: "wu-handoff-1",
    requestedAt: "2026-06-03T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: actorId, type: "system" },
    intent: "adoptimizer.recommendation.handoff",
    parameters: {
      recommendationId: "rec_1",
      actionType: "refresh_creative",
      campaignId: "camp_1",
      rationale: "creative fatigue",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    },
    deployment: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace-handoff-1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function handoffRegistration(): IntentRegistration {
  return {
    intent: "adoptimizer.recommendation.handoff",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "adoptimizer.recommendation.handoff" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

function buildGate(policies: Policy[], specResolves: boolean): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => {
      if (!specResolves) {
        // A bespoke / un-seeded system principal id has no IdentitySpec.
        throw new Error("IdentitySpec not found");
      }
      return { spec: systemSpec(), overlays: [] };
    },
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

describe("adoptimizer.recommendation.handoff governance gate", () => {
  it("parks at MANDATORY with the seeded allow + require_approval policies and the system principal", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()], true);
    const decision = await gate.evaluate(handoffWorkUnit(), handoffRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("default-DENIES on an un-seeded org (no allow policy) - fail safe", async () => {
    const gate = buildGate([], true);
    const decision = await gate.evaluate(handoffWorkUnit(), handoffRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("hard-denies when the principal has no IdentitySpec (the cross-agent bite)", async () => {
    // A bespoke `system:bespoke` id has no seeded IdentitySpec, so loadIdentitySpec
    // throws inside the gate. PlatformIngress wraps gate.evaluate in a try/catch and
    // converts the throw to a GOVERNANCE_ERROR deny with empty outputs:{} (a silent
    // no-op) - proven here by asserting the gate rejects (the source of that deny).
    const gate = buildGate([allowPolicy(), approvalPolicy()], false);
    await expect(
      gate.evaluate(handoffWorkUnit("system:bespoke"), handoffRegistration()),
    ).rejects.toThrow();
  });

  it("the anchored handoff policy does NOT elevate creative.job.continue", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()], true);
    const continueWu = {
      ...handoffWorkUnit(),
      id: "wu-cont-1",
      intent: "creative.job.continue",
      parameters: { jobId: "j1" },
    } as WorkUnit;
    const continueReg: IntentRegistration = {
      ...handoffRegistration(),
      intent: "creative.job.continue",
      approvalPolicy: "threshold",
      executor: { mode: "workflow", workflowId: "creative.job.continue" },
    };
    const decision = await gate.evaluate(continueWu, continueReg);
    // No allow policy matches creative.job.continue in THIS policy set -> default
    // deny; the load-bearing assertion is that it is NOT forced to
    // require_approval(mandatory) by the anchored handoff rule.
    expect(decision.outcome).not.toBe("require_approval");
  });
});
