import { describe, it, expect, vi } from "vitest";
import { GovernanceGate } from "../governance/governance-gate.js";
import type { GovernanceGateDeps } from "../governance/governance-gate.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { DecisionTrace, IdentitySpec } from "@switchboard/schemas";
import type { ResolvedIdentity } from "../../identity/spec.js";

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: "2026-04-16T00:00:00.000Z",
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "crm.deal.update",
    parameters: { dealId: "d-1", stage: "closed" },
    resolvedMode: "skill",
    traceId: "trace-1",
    trigger: "chat",
    priority: "normal",
    ...overrides,
  };
}

function makeRegistration(overrides?: Partial<IntentRegistration>): IntentRegistration {
  return {
    intent: "crm.deal.update",
    defaultMode: "skill",
    allowedModes: ["skill"],
    executor: { mode: "skill", skillSlug: "update-deal" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "standard",
    approvalPolicy: "none",
    idempotent: false,
    allowedTriggers: ["chat", "api"],
    timeoutMs: 30_000,
    retryable: false,
    ...overrides,
  };
}

function makeIdentitySpec(overrides?: Partial<IdentitySpec>): IdentitySpec {
  return {
    id: "spec-1",
    principalId: "user-1",
    organizationId: "org-1",
    name: "Test Agent",
    description: "Test identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 1000, weekly: 5000, monthly: 20_000, perAction: 500 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeResolvedIdentity(spec: IdentitySpec): ResolvedIdentity {
  return {
    spec,
    activeOverlays: [],
    effectiveRiskTolerance: { ...spec.riskTolerance },
    effectiveSpendLimits: { ...spec.globalSpendLimits },
    effectiveForbiddenBehaviors: [...spec.forbiddenBehaviors],
    effectiveTrustBehaviors: [...spec.trustBehaviors],
    delegatedApprovers: [],
  };
}

function makeTrace(overrides?: Partial<DecisionTrace>): DecisionTrace {
  return {
    actionId: "wu-1",
    envelopeId: "unknown",
    checks: [
      {
        checkCode: "POLICY_RULE",
        checkData: {},
        humanDetail: "Policy matched",
        matched: true,
        effect: "allow",
      },
    ],
    computedRiskScore: { rawScore: 10, category: "low", factors: [] },
    finalDecision: "allow",
    approvalRequired: "none",
    explanation: "",
    evaluatedAt: new Date("2026-04-16"),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<GovernanceGateDeps>): GovernanceGateDeps {
  const spec = makeIdentitySpec();
  return {
    evaluate: vi.fn().mockReturnValue(makeTrace()),
    resolveIdentity: vi.fn().mockReturnValue(makeResolvedIdentity(spec)),
    loadPolicies: vi.fn().mockResolvedValue([]),
    loadIdentitySpec: vi.fn().mockResolvedValue({ spec, overlays: [] }),
    ...overrides,
  };
}

describe("GovernanceGate", () => {
  it("returns execute decision when policy allows", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(makeWorkUnit(), makeRegistration());

    expect(decision.outcome).toBe("execute");
    expect(decision.riskScore).toBe(10);
    expect(decision.matchedPolicies).toContain("POLICY_RULE");
  });

  it("returns deny decision when policy denies", async () => {
    const trace = makeTrace({
      finalDecision: "deny",
      checks: [
        {
          checkCode: "FORBIDDEN_BEHAVIOR",
          checkData: {},
          humanDetail: "Forbidden",
          matched: true,
          effect: "deny",
        },
      ],
    });
    const deps = makeDeps({ evaluate: vi.fn().mockReturnValue(trace) });
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(makeWorkUnit(), makeRegistration());

    expect(decision.outcome).toBe("deny");
    if (decision.outcome === "deny") {
      expect(decision.reasonCode).toBe("FORBIDDEN_BEHAVIOR");
    }
  });

  it("returns require_approval when approval required", async () => {
    const trace = makeTrace({
      finalDecision: "allow",
      approvalRequired: "elevated",
    });
    const deps = makeDeps({ evaluate: vi.fn().mockReturnValue(trace) });
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(makeWorkUnit(), makeRegistration());

    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("elevated");
    }
  });

  it("calls loadPolicies and loadIdentitySpec with correct args", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);
    const workUnit = makeWorkUnit({
      organizationId: "org-42",
      actor: { id: "actor-7", type: "agent" },
    });

    await gate.evaluate(workUnit, makeRegistration());

    expect(deps.loadPolicies).toHaveBeenCalledWith("org-42");
    expect(deps.loadIdentitySpec).toHaveBeenCalledWith("actor-7");
  });

  it("passes constraints from registration", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);
    const registration = makeRegistration({ budgetClass: "expensive", timeoutMs: 60_000 });

    const decision = await gate.evaluate(makeWorkUnit(), registration);

    expect(decision.outcome).toBe("execute");
    if (decision.outcome === "execute") {
      expect(decision.constraints.maxTotalTokens).toBe(128_000);
      expect(decision.constraints.maxLlmTurns).toBe(10);
      expect(decision.constraints.maxRuntimeMs).toBe(60_000);
      expect(decision.constraints.allowedModelTiers).toContain("critical");
    }
  });
});
