/**
 * adoptimizer.campaign.pause, exercised through the REAL GovernanceGate + policy
 * engine (NOT a spy ingress). Proves the Phase-C pause gate AND its decomposition:
 *
 *   - allow + approval policies + seeded system principal -> parks at MANDATORY,
 *   - the AUTONOMOUS trustLevelOverride on Riley's deployment does NOT relax it
 *     (the spend lever relaxes only "standard"; a pause carries no spendAmount),
 *   - allow ALONE -> executes (documents the approval policy is load-bearing;
 *     never seed one without the other),
 *   - approval ALONE -> pinned below (the allow leg is what un-denies),
 *   - un-seeded org -> default-DENY (fail safe),
 *   - a bespoke (un-seeded) system principal id hard-denies (the cross-agent bite),
 *   - the anchored pause rule does NOT bleed onto the handoff intent.
 *
 * Mirrors recommendation-handoff-gate.test.ts (the proven real-gate harness).
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  RILEY_PAUSE_ALLOW_POLICY_RULE,
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
} from "@switchboard/db";
import { RILEY_PAUSE_INTENT } from "../services/workflows/riley-pause-submit-request.js";

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

/** Build Policy rows from the SAME db builders the production seed uses. */
function allowPolicy(): Policy {
  const p = buildRileyPauseAllowPolicyInput(ORG);
  return {
    ...p,
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function approvalPolicy(): Policy {
  const p = buildRileyPauseApprovalPolicyInput(ORG);
  return {
    ...p,
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function pauseWorkUnit(opts?: { actorId?: string; trustLevelOverride?: "autonomous" }): WorkUnit {
  return {
    id: "wu-pause-1",
    requestedAt: "2026-06-06T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: opts?.actorId ?? "system", type: "system" },
    intent: RILEY_PAUSE_INTENT,
    parameters: {
      recommendationId: "rec_1",
      actionType: "pause",
      campaignId: "camp_1",
      rationale: "sustained spend with zero booked revenue",
      evidence: { clicks: 100, conversions: 10, days: 7 },
    },
    deployment: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
      ...(opts?.trustLevelOverride ? { trustLevelOverride: opts.trustLevelOverride } : {}),
    },
    resolvedMode: "workflow",
    traceId: "trace-pause-1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function pauseRegistration(): IntentRegistration {
  return {
    intent: RILEY_PAUSE_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: RILEY_PAUSE_INTENT },
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

describe("adoptimizer.campaign.pause governance gate (real engine)", () => {
  it("parks at MANDATORY with the seeded allow + require_approval policies and the system principal", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()], true);
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("the AUTONOMOUS trust override does NOT relax the mandatory park", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()], true);
    const decision = await gate.evaluate(
      pauseWorkUnit({ trustLevelOverride: "autonomous" }),
      pauseRegistration(),
    );
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("DECOMPOSITION: allow alone EXECUTES (the approval policy is load-bearing; never seed one without the other)", async () => {
    const gate = buildGate([allowPolicy()], true);
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("execute");
  });

  it("DECOMPOSITION: approval alone still parks at mandatory (its match also un-denies; pinned so engine changes surface here)", async () => {
    // Observed engine semantics (policy-engine.ts: a matched require_approval
    // policy with approvalRequirement also sets policyDecision="allow" when null):
    // the approval policy alone parks. That is SAFER than deny-by-default for this
    // intent; this leg pins the observed behavior so a future engine change that
    // turns it into allow-wins or deny is a visible break, not a silent shift.
    const gate = buildGate([approvalPolicy()], true);
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("default-DENIES on an un-seeded org (no policies) - fail safe", async () => {
    const gate = buildGate([], true);
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("hard-denies when the principal has no IdentitySpec (the cross-agent bite)", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()], false);
    await expect(
      gate.evaluate(pauseWorkUnit({ actorId: "system:bespoke" }), pauseRegistration()),
    ).rejects.toThrow();
  });

  it("the anchored pause rule does NOT bleed onto the handoff intent", () => {
    const re = new RegExp(RILEY_PAUSE_ALLOW_POLICY_RULE.conditions[0]!.value);
    expect(re.test("adoptimizer.recommendation.handoff")).toBe(false);
    expect(re.test("adoptimizer.campaign.pause")).toBe(true);
  });
});
