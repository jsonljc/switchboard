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
import {
  resolveTrustLevelOverride,
  resolveSpendAutonomyEnabled,
  type IdentitySpec,
  type Policy,
} from "@switchboard/schemas";
// Drive the gate from the SAME governance config the seed installs (run through the
// REAL resolvers production uses), so a governanceSettings rename can't leave this
// test a false green. See feedback_safety_gate_needs_producer_population.
import {
  CREATIVE_GOVERNANCE_SETTINGS,
  CREATIVE_ALLOW_POLICY_RULE,
  CREATIVE_SPEND_APPROVAL_THRESHOLD,
} from "@switchboard/db";
// The REAL render-cost producer — so the over/under-threshold cases are proven from
// amounts the producer can actually emit, not synthetic numbers it never would.
import { computeRenderSpend } from "../services/creative-render-spend.js";

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
    rule: CREATIVE_ALLOW_POLICY_RULE,
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

// Realistic persisted storyboards the REAL producer (computeRenderSpend → estimateCost)
// consumes. A small single-script clip lands well under the seeded threshold; a large
// 5-script, 6-scene, 10s batch lands well over it — proving the producer straddles the
// configured cap (not just that the lever's arithmetic works on a synthetic number).
const SMALL_STORYBOARD_JOB = {
  stageOutputs: {
    storyboard: { storyboards: [{ scenes: [{ duration: 5 }, { duration: 5 }, { duration: 5 }] }] },
    scripts: { scripts: [{}] },
  },
};
const LARGE_STORYBOARD_JOB = {
  stageOutputs: {
    storyboard: {
      storyboards: [{ scenes: Array.from({ length: 6 }, () => ({ duration: 10 })) }],
    },
    scripts: { scripts: Array.from({ length: 5 }, () => ({})) },
  },
};

describe("creative spend gate (real GovernanceGate + real producer)", () => {
  // Posture the seed configures — trust override + spend-autonomy derived from the
  // seed's governanceSettings via the REAL resolvers, and the REAL seeded threshold,
  // so a seed change (key rename OR threshold value) flows into this test.
  const SEEDED: DeploymentPosture = {
    trustLevelOverride: resolveTrustLevelOverride(CREATIVE_GOVERNANCE_SETTINGS),
    spendAutonomyEnabled: resolveSpendAutonomyEnabled(CREATIVE_GOVERNANCE_SETTINGS),
    spendApprovalThreshold: CREATIVE_SPEND_APPROVAL_THRESHOLD,
  };

  it("default-denies creative.job.continue when no allow policy matches (the #810 latent gap)", async () => {
    const gate = buildGate([]); // real/pilot orgs seed NO policies
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1" }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("deny");
  });

  it("executes a real at/under-threshold render (producer cost < seeded threshold)", async () => {
    const cost = await computeRenderSpend(SMALL_STORYBOARD_JOB, "basic");
    expect(cost).not.toBeNull();
    expect(cost!).toBeLessThan(CREATIVE_SPEND_APPROVAL_THRESHOLD);
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1", productionTier: "basic", spendAmount: cost }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });

  it("parks a real over-threshold render for approval (producer cost > seeded threshold)", async () => {
    const cost = await computeRenderSpend(LARGE_STORYBOARD_JOB, "pro");
    expect(cost).not.toBeNull();
    // The producer CAN emit an over-threshold amount — the seam this PR exists to close.
    expect(cost!).toBeGreaterThan(CREATIVE_SPEND_APPROVAL_THRESHOLD);
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1", productionTier: "pro", spendAmount: cost }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("does NOT park a real over-threshold render when the deployment is not autonomous (posture required)", async () => {
    const cost = await computeRenderSpend(LARGE_STORYBOARD_JOB, "pro");
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit(
        { jobId: "j1", productionTier: "pro", spendAmount: cost },
        { spendApprovalThreshold: CREATIVE_SPEND_APPROVAL_THRESHOLD }, // no trustLevelOverride/spendAutonomy
      ),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });

  // ── Slice-3: the UGC leg of the SAME producer drives the SAME gate (3.3b) ──

  const ugcSpec = (durationSec: number) => ({
    renderTargets: { durationSec },
    providersAllowed: ["kling"],
  });
  // 50 ten-second clips = 50 x $0.70 = $35, over the $15 seeded threshold;
  // 2 short clips = $0.70, well under.
  const LARGE_UGC_JOB = {
    mode: "ugc",
    ugcPhase: "production",
    ugcFailure: null,
    stoppedAt: null,
    stageOutputs: {},
    ugcPhaseOutputs: { scripting: { specs: Array.from({ length: 50 }, () => ugcSpec(10)) } },
  };
  const SMALL_UGC_JOB = {
    ...LARGE_UGC_JOB,
    ugcPhaseOutputs: { scripting: { specs: [ugcSpec(5), ugcSpec(5)] } },
  };

  it("parks a real over-threshold UGC render at the approve-into-production gate", async () => {
    const cost = await computeRenderSpend(LARGE_UGC_JOB, undefined);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(CREATIVE_SPEND_APPROVAL_THRESHOLD);
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1", spendAmount: cost }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("executes an under-threshold UGC render", async () => {
    const cost = await computeRenderSpend(SMALL_UGC_JOB, undefined);
    expect(cost).not.toBeNull();
    expect(cost!).toBeLessThan(CREATIVE_SPEND_APPROVAL_THRESHOLD);
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1", spendAmount: cost }, SEEDED),
      continueRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });

  it("the delivery-gate approve carries NO spend (negative case): money already spent", async () => {
    // After production runs, ugcPhase is "delivery" and specs are still
    // present; the producer must return null so the route omits spendAmount
    // and the lever no-ops (no false park for spent money).
    const cost = await computeRenderSpend({ ...LARGE_UGC_JOB, ugcPhase: "delivery" }, undefined);
    expect(cost).toBeNull();
    const gate = buildGate([creativeAllowPolicy()]);
    const decision = await gate.evaluate(
      makeWorkUnit({ jobId: "j1" }, SEEDED), // no spendAmount param at all
      continueRegistration(),
    );
    expect(decision.outcome).toBe("execute");
  });
});
