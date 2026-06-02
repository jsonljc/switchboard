/**
 * creative.job.publish, exercised through the REAL GovernanceGate + policy engine
 * + applySpendApprovalThreshold (NOT a spy ingress). Proves the claim-safety gate:
 *
 *   - WITH the seeded allow + require_approval(mandatory) policies → parks at
 *     MANDATORY (the decorative `approvalPolicy:"always"` is NOT what gates it),
 *   - the $0-spend autonomy lever cannot relax it (no SPEND_APPROVAL_THRESHOLD
 *     marker — publish carries no spend key, and mandatory is non-downgradeable),
 *   - an un-seeded org default-DENIES (fail safe),
 *   - the anchored publish rule does NOT bleed onto creative.job.continue.
 *
 * Mirrors creative-spend-gate.test.ts (the proven real-gate harness).
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  CREATIVE_ALLOW_POLICY_RULE,
  buildCreativePublishApprovalPolicyInput,
} from "@switchboard/db";

const ORG = "org-acme";
const ACTOR = "user-zoe";

function operatorSpec(): IdentitySpec {
  return {
    id: "spec-zoe",
    principalId: ACTOR,
    organizationId: ORG,
    name: "Operator",
    description: "Plain operator identity",
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
    id: "policy_allow_creative",
    name: "Allow creative pipeline actions",
    description: "allow",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: CREATIVE_ALLOW_POLICY_RULE,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function publishApprovalPolicy(): Policy {
  const p = buildCreativePublishApprovalPolicyInput(ORG);
  return {
    ...p,
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

const AUTONOMOUS = {
  deploymentId: "dep-creative",
  skillSlug: "creative",
  trustLevel: "guided",
  trustScore: 0,
  trustLevelOverride: "autonomous" as const,
  spendAutonomyEnabled: true,
  policyOverrides: { spendApprovalThreshold: 15 },
};

function publishWorkUnit(): WorkUnit {
  return {
    id: "wu-pub-1",
    requestedAt: "2026-06-02T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: ACTOR, type: "user" },
    intent: "creative.job.publish",
    parameters: { jobId: "j1" },
    deployment: AUTONOMOUS,
    resolvedMode: "workflow",
    traceId: "trace-pub-1",
    trigger: "api",
    priority: "normal",
  } as WorkUnit;
}

function publishRegistration(): IntentRegistration {
  return {
    intent: "creative.job.publish",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "creative.job.publish" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["api"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: operatorSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

describe("creative.job.publish governance gate", () => {
  it("parks at MANDATORY with the seeded allow + require_approval policies", async () => {
    const gate = buildGate([allowPolicy(), publishApprovalPolicy()]);
    const decision = await gate.evaluate(publishWorkUnit(), publishRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
      // The $0-spend autonomy lever never engaged (publish carries no spend key,
      // and "mandatory" is non-downgradeable) — no threshold marker.
      expect(decision.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
    }
  });

  it("default-DENIES on an un-seeded org (no allow policy) — fail safe", async () => {
    const gate = buildGate([]);
    const decision = await gate.evaluate(publishWorkUnit(), publishRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("the anchored publish policy does NOT elevate creative.job.continue", async () => {
    const gate = buildGate([allowPolicy(), publishApprovalPolicy()]);
    const continueWu = {
      ...publishWorkUnit(),
      id: "wu-cont-1",
      intent: "creative.job.continue",
      parameters: { jobId: "j1", productionTier: "basic", spendAmount: 1 },
    } as WorkUnit;
    const continueReg: IntentRegistration = {
      ...publishRegistration(),
      intent: "creative.job.continue",
      approvalPolicy: "threshold",
      executor: { mode: "workflow", workflowId: "creative.job.continue" },
    };
    const decision = await gate.evaluate(continueWu, continueReg);
    // Small spend under autonomous+threshold executes — it is NOT forced to
    // mandatory by the publish policy (which matches creative.job.publish only).
    expect(decision.outcome).toBe("execute");
  });
});
