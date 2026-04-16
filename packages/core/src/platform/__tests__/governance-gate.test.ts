import { describe, it, expect, vi } from "vitest";
import { GovernanceGate } from "../governance/governance-gate.js";
import type { GovernanceGateDeps, GovernanceCartridge } from "../governance/governance-gate.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { DecisionTrace, IdentitySpec, RiskInput, GuardrailConfig } from "@switchboard/schemas";
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

function makeCartridgeRegistration(overrides?: Partial<IntentRegistration>): IntentRegistration {
  return makeRegistration({
    executor: { mode: "cartridge", actionId: "crm-cartridge" },
    ...overrides,
  });
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

function makeCartridge(overrides?: Partial<GovernanceCartridge>): GovernanceCartridge {
  return {
    manifest: { id: "crm-cartridge", actions: [{ actionType: "crm.deal.update" }] },
    getGuardrails: vi.fn().mockReturnValue(null),
    enrichContext: vi.fn().mockResolvedValue({}),
    getRiskInput: vi.fn().mockResolvedValue({
      baseRisk: "medium",
      exposure: { dollarsAtRisk: 100, blastRadius: 5 },
      reversibility: "partial",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: true },
    } satisfies RiskInput),
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
    loadCartridge: vi.fn().mockResolvedValue(null),
    getGovernanceProfile: vi.fn().mockResolvedValue(null),
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

  it("uses DEFAULT_CARTRIDGE_CONSTRAINTS for execute decisions", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(makeWorkUnit(), makeRegistration());

    expect(decision.outcome).toBe("execute");
    if (decision.outcome === "execute") {
      expect(decision.constraints.maxToolCalls).toBe(10);
      expect(decision.constraints.maxLlmTurns).toBe(1);
      expect(decision.constraints.maxRuntimeMs).toBe(30_000);
      expect(decision.constraints.allowedModelTiers).toEqual(["default"]);
    }
  });

  it("loads cartridge for risk input enrichment", async () => {
    const cartridge = makeCartridge();
    const deps = makeDeps({
      loadCartridge: vi.fn().mockResolvedValue(cartridge),
    });
    const gate = new GovernanceGate(deps);
    const registration = makeCartridgeRegistration();

    await gate.evaluate(makeWorkUnit(), registration);

    expect(deps.loadCartridge).toHaveBeenCalledWith("crm-cartridge");
    expect(cartridge.getRiskInput).toHaveBeenCalledWith(
      "crm.deal.update",
      { dealId: "d-1", stage: "closed" },
      {},
    );

    // Verify the engine context received by evaluate has the cartridge risk input
    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const engineContext = evaluateCall[2];
    expect(engineContext.riskInput).toEqual({
      baseRisk: "medium",
      exposure: { dollarsAtRisk: 100, blastRadius: 5 },
      reversibility: "partial",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: true },
    });
  });

  it("uses default risk input when cartridge is not found", async () => {
    const deps = makeDeps({
      loadCartridge: vi.fn().mockResolvedValue(null),
    });
    const gate = new GovernanceGate(deps);
    const registration = makeCartridgeRegistration();

    await gate.evaluate(makeWorkUnit(), registration);

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const engineContext = evaluateCall[2];
    expect(engineContext.riskInput).toEqual({
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    });
  });

  it("uses default risk input when cartridge.getRiskInput throws", async () => {
    const cartridge = makeCartridge({
      getRiskInput: vi.fn().mockRejectedValue(new Error("cartridge error")),
    });
    const deps = makeDeps({
      loadCartridge: vi.fn().mockResolvedValue(cartridge),
    });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeCartridgeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const engineContext = evaluateCall[2];
    expect(engineContext.riskInput.baseRisk).toBe("low");
  });

  it("loads guardrails from cartridge", async () => {
    const guardrails: GuardrailConfig = {
      rateLimits: [{ scope: "global", maxActions: 5, windowMs: 60_000 }],
      cooldowns: [],
      protectedEntities: [],
    };
    const cartridge = makeCartridge({
      getGuardrails: vi.fn().mockReturnValue(guardrails),
    });
    const deps = makeDeps({
      loadCartridge: vi.fn().mockResolvedValue(cartridge),
    });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeCartridgeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const engineContext = evaluateCall[2];
    expect(engineContext.guardrails).toBe(guardrails);
  });

  it("builds system risk posture from governance profile", async () => {
    const deps = makeDeps({
      getGovernanceProfile: vi.fn().mockResolvedValue("strict"),
    });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const engineContext = evaluateCall[2];
    expect(engineContext.systemRiskPosture).toBe("elevated");
  });

  it("defaults to guarded profile when getGovernanceProfile returns null", async () => {
    const deps = makeDeps({
      getGovernanceProfile: vi.fn().mockResolvedValue(null),
    });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const engineContext = evaluateCall[2];
    // guarded maps to "normal"
    expect(engineContext.systemRiskPosture).toBe("normal");
  });

  it("does not load cartridge for non-cartridge executors", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    expect(deps.loadCartridge).not.toHaveBeenCalled();
  });

  it("passes riskScoringConfig to evaluate when provided", async () => {
    const riskScoringConfig = { volatilityMultiplier: 2 };
    const deps = makeDeps({ riskScoringConfig });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    const config = evaluateCall[3];
    expect(config).toEqual({ riskScoringConfig });
  });

  it("resolves identity with cartridgeId context", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeCartridgeRegistration());

    expect(deps.resolveIdentity).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      cartridgeId: "crm-cartridge",
    });
  });
});
