/**
 * P2a-iii — the creative spend-approval gate, exercised through the REAL
 * GovernanceGate + real policy engine + real `applySpendApprovalThreshold`
 * (NOT a spy ingress). Proves the threshold actually enforces:
 *
 *   - render cost ABOVE the deployment threshold parks for approval,
 *   - render cost AT/UNDER executes,
 *
 * and characterizes the pre-existing default-deny baseline that the #810 spy
 * tests could not see (a workflow intent with no allow policy default-denies).
 *
 * Per feedback_safety_gate_needs_producer_population, the threshold must be
 * driven from the real producer's amount + the real deployment posture — see
 * the seed test + producer test for the other halves of the chain.
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";

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

/** An org-scoped allow policy for the creative pipeline intents. */
function creativeAllowPolicy(): Policy {
  return {
    id: "policy_allow_creative",
    name: "Allow creative pipeline actions",
    description:
      "Creative generation/continue/stop are governed by the spend threshold, not denied",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "matches", value: "creative.job.*" }],
      children: [],
    },
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

interface DeploymentPosture {
  trustLevelOverride?: "supervised" | "guided" | "autonomous";
  spendAutonomyEnabled?: boolean;
  spendApprovalThreshold?: number;
}

function makeWorkUnit(parameters: Record<string, unknown>, posture: DeploymentPosture): WorkUnit {
  return {
    id: "wu-creative-1",
    requestedAt: "2026-06-02T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: ACTOR, type: "user" },
    intent: "creative.job.continue",
    parameters,
    deployment: {
      deploymentId: "dep-creative",
      skillSlug: "creative",
      trustLevel: "guided",
      trustScore: 0,
      trustLevelOverride: posture.trustLevelOverride,
      spendAutonomyEnabled: posture.spendAutonomyEnabled,
      policyOverrides:
        posture.spendApprovalThreshold !== undefined
          ? { spendApprovalThreshold: posture.spendApprovalThreshold }
          : undefined,
    },
    resolvedMode: "workflow",
    traceId: "trace-creative-1",
    trigger: "api",
    priority: "normal",
  };
}

function continueRegistration(): IntentRegistration {
  return {
    intent: "creative.job.continue",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "creative.job.continue" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "threshold",
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

describe("creative spend gate (real GovernanceGate)", () => {
  // Posture the seed will configure: autonomous + spend-autonomy + a creative threshold.
  const SEEDED: DeploymentPosture = {
    trustLevelOverride: "autonomous",
    spendAutonomyEnabled: true,
    spendApprovalThreshold: 50,
  };

  it("default-denies creative.job.continue when no allow policy matches (the #810 latent gap)", async () => {
    const gate = buildGate([]); // real/pilot orgs seed NO policies
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1" }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("deny");
  });

  it("executes an at/under-threshold render when an allow policy is present", async () => {
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1", productionTier: "pro", spendAmount: 12 }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });

  it("parks an over-threshold render for approval (the spend gate)", async () => {
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1", productionTier: "pro", spendAmount: 120 }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("does NOT park an over-threshold render when the deployment is not autonomous (posture required)", async () => {
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit(
        { jobId: "j1", productionTier: "pro", spendAmount: 120 },
        { spendApprovalThreshold: 50 }, // no trustLevelOverride/spendAutonomy
      ),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });
});
