// Locks in the deny-loop-break behavior at packages/core/src/engine/policy-engine.ts:309-313:
// when a policy with effect="deny" matches, the loop breaks immediately and the final decision
// is "deny" — regardless of array order, regardless of whether an earlier-iterated allow had
// already been recorded. Allow does NOT short-circuit, so a later deny can still flip the
// decision. Net invariant: among matched policies, deny always wins.
//
// Split out from engine-policy.test.ts to keep that file under the 600-line cap.

import { describe, it, expect } from "vitest";

import { evaluate, createGuardrailState } from "../index.js";

import type { EvaluationContext, PolicyEngineContext, ResolvedIdentity } from "../index.js";

import type { RiskInput, IdentitySpec, Policy, ActionProposal } from "@switchboard/schemas";

function makeEvalContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    actionType: "campaign.update_budget",
    parameters: { amount: 500 },
    cartridgeId: "google-ads",
    principalId: "user-1",
    organizationId: "org-1",
    riskCategory: "medium",
    metadata: {},
    ...overrides,
  };
}

function makeBaseIdentitySpec(overrides: Partial<IdentitySpec> = {}): IdentitySpec {
  return {
    id: "spec-1",
    principalId: "user-1",
    organizationId: "org-1",
    name: "Test Agent",
    description: "A test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10000, weekly: 50000, monthly: 200000, perAction: 5000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeResolvedIdentity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  const spec = makeBaseIdentitySpec();
  return {
    spec,
    activeOverlays: [],
    effectiveRiskTolerance: { ...spec.riskTolerance },
    effectiveSpendLimits: { ...spec.globalSpendLimits },
    effectiveForbiddenBehaviors: [...spec.forbiddenBehaviors],
    effectiveTrustBehaviors: [...spec.trustBehaviors],
    delegatedApprovers: [],
    ...overrides,
  };
}

function makeRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    ...overrides,
  };
}

function makeProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "action-1",
    actionType: "campaign.update_budget",
    parameters: { amount: 500 },
    evidence: "User asked to increase budget",
    confidence: 0.95,
    originatingMessageId: "msg-1",
    ...overrides,
  };
}

function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: "policy-1",
    name: "Test Policy",
    description: "A test policy",
    organizationId: null,
    cartridgeId: null,
    priority: 10,
    active: true,
    rule: { composition: "AND", conditions: [], children: [] },
    effect: "allow",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeEngineContext(overrides: Partial<PolicyEngineContext> = {}): PolicyEngineContext {
  return {
    policies: [],
    guardrails: null,
    guardrailState: createGuardrailState(),
    resolvedIdentity: makeResolvedIdentity(),
    riskInput: makeRiskInput(),
    now: new Date(),
    ...overrides,
  };
}

const matchAllRule = {
  composition: "AND" as const,
  conditions: [{ field: "actionType", operator: "eq" as const, value: "campaign.update_budget" }],
};

describe("Policy Engine — Conflict Resolution", () => {
  it("same priority, [allow, deny] order -> deny wins (allow set, then deny breaks)", () => {
    const allowPolicy = makePolicy({
      id: "allow-policy",
      name: "Allow budget updates",
      priority: 10,
      effect: "allow",
      rule: matchAllRule,
    });
    const denyPolicy = makePolicy({
      id: "deny-policy",
      name: "Deny budget updates",
      priority: 10,
      effect: "deny",
      rule: matchAllRule,
    });

    const trace = evaluate(
      makeProposal(),
      makeEvalContext(),
      makeEngineContext({ policies: [allowPolicy, denyPolicy] }),
    );
    expect(trace.finalDecision).toBe("deny");

    const matched = trace.checks.filter((c) => c.checkCode === "POLICY_RULE" && c.matched);
    expect(matched).toHaveLength(2);
    expect(matched[0]!.effect).toBe("allow");
    expect(matched[1]!.effect).toBe("deny");
  });

  it("same priority, [deny, allow] order -> deny wins (allow never evaluated)", () => {
    const denyPolicy = makePolicy({
      id: "deny-policy",
      name: "Deny budget updates",
      priority: 10,
      effect: "deny",
      rule: matchAllRule,
    });
    const allowPolicy = makePolicy({
      id: "allow-policy",
      name: "Allow budget updates",
      priority: 10,
      effect: "allow",
      rule: matchAllRule,
    });

    const trace = evaluate(
      makeProposal(),
      makeEvalContext(),
      makeEngineContext({ policies: [denyPolicy, allowPolicy] }),
    );
    expect(trace.finalDecision).toBe("deny");

    const policyChecks = trace.checks.filter((c) => c.checkCode === "POLICY_RULE");
    expect(policyChecks).toHaveLength(1);
    expect(policyChecks[0]!.effect).toBe("deny");
    expect(policyChecks[0]!.matched).toBe(true);
  });

  it("different priorities, deny@1 + allow@10 -> deny breaks immediately", () => {
    const denyPolicy = makePolicy({
      id: "deny-policy",
      name: "Deny budget updates",
      priority: 1,
      effect: "deny",
      rule: matchAllRule,
    });
    const allowPolicy = makePolicy({
      id: "allow-policy",
      name: "Allow budget updates",
      priority: 10,
      effect: "allow",
      rule: matchAllRule,
    });

    const trace = evaluate(
      makeProposal(),
      makeEvalContext(),
      makeEngineContext({ policies: [allowPolicy, denyPolicy] }),
    );
    expect(trace.finalDecision).toBe("deny");

    const policyChecks = trace.checks.filter((c) => c.checkCode === "POLICY_RULE");
    expect(policyChecks).toHaveLength(1);
    expect(policyChecks[0]!.effect).toBe("deny");
  });

  it("different priorities, allow@1 + deny@10 -> allow set first, deny breaks; deny wins", () => {
    const allowPolicy = makePolicy({
      id: "allow-policy",
      name: "Allow budget updates",
      priority: 1,
      effect: "allow",
      rule: matchAllRule,
    });
    const denyPolicy = makePolicy({
      id: "deny-policy",
      name: "Deny budget updates",
      priority: 10,
      effect: "deny",
      rule: matchAllRule,
    });

    const trace = evaluate(
      makeProposal(),
      makeEvalContext(),
      makeEngineContext({ policies: [denyPolicy, allowPolicy] }),
    );
    expect(trace.finalDecision).toBe("deny");

    const matched = trace.checks.filter((c) => c.checkCode === "POLICY_RULE" && c.matched);
    expect(matched).toHaveLength(2);
    expect(matched[0]!.effect).toBe("allow");
    expect(matched[1]!.effect).toBe("deny");
  });

  it("same priority, two allows -> allow wins (positive control: no break on allow)", () => {
    const allowA = makePolicy({
      id: "allow-a",
      name: "Allow budget updates A",
      priority: 10,
      effect: "allow",
      rule: matchAllRule,
    });
    const allowB = makePolicy({
      id: "allow-b",
      name: "Allow budget updates B",
      priority: 10,
      effect: "allow",
      rule: matchAllRule,
    });

    const trace = evaluate(
      makeProposal(),
      makeEvalContext(),
      makeEngineContext({ policies: [allowA, allowB] }),
    );
    expect(trace.finalDecision).toBe("allow");

    const matched = trace.checks.filter((c) => c.checkCode === "POLICY_RULE" && c.matched);
    expect(matched).toHaveLength(2);
    expect(matched.every((c) => c.effect === "allow")).toBe(true);
  });
});
