import { describe, it, expect, vi } from "vitest";
import { GovernanceGate } from "../governance/governance-gate.js";
import type { GovernanceGateDeps, GovernanceCartridge } from "../governance/governance-gate.js";
import type { WorkUnit } from "../work-unit.js";
import type { IntentRegistration } from "../intent-registration.js";
import { SpendBearingAutoApproveError } from "../intent-registration.js";
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
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "test-skill",
      trustLevel: "guided",
      trustScore: 42,
    },
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
    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
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

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
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

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
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

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const engineContext = evaluateCall[2];
    expect(engineContext.guardrails).toBe(guardrails);
  });

  it("builds system risk posture from governance profile", async () => {
    const deps = makeDeps({
      getGovernanceProfile: vi.fn().mockResolvedValue("strict"),
    });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const engineContext = evaluateCall[2];
    expect(engineContext.systemRiskPosture).toBe("elevated");
  });

  it("defaults to guarded profile when getGovernanceProfile returns null", async () => {
    const deps = makeDeps({
      getGovernanceProfile: vi.fn().mockResolvedValue(null),
    });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
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
    // Use a partial config cast — test only verifies passthrough, not engine behavior
    const riskScoringConfig = {
      volatilityMultiplier: 2,
    } as unknown as GovernanceGateDeps["riskScoringConfig"];
    const deps = makeDeps({ riskScoringConfig });
    const gate = new GovernanceGate(deps);

    await gate.evaluate(makeWorkUnit(), makeRegistration());

    const evaluateCall = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls[0]!;
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

  describe("approvalMode short-circuit (Amendment 1)", () => {
    it('skips policy lookup when approvalMode is "system_auto_approved"', async () => {
      // Mock deps that would deny if policy engine ran — proves we short-circuit before reaching it.
      const deps = makeDeps({
        evaluate: vi.fn().mockReturnValue(makeTrace({ finalDecision: "deny" })),
      });
      const gate = new GovernanceGate(deps);

      const registration = makeRegistration({
        intent: "operator.transition_opportunity_stage",
        approvalMode: "system_auto_approved",
      });

      const decision = await gate.evaluate(makeWorkUnit(), registration);

      expect(decision.outcome).toBe("execute");
      expect(deps.evaluate).not.toHaveBeenCalled();
      expect(deps.loadPolicies).not.toHaveBeenCalled();
    });

    it('falls through to policy evaluation when approvalMode is "policy"', async () => {
      const deps = makeDeps();
      const gate = new GovernanceGate(deps);

      await gate.evaluate(makeWorkUnit(), makeRegistration({ approvalMode: "policy" }));

      expect(deps.evaluate).toHaveBeenCalledOnce();
    });

    it("defaults to policy evaluation when approvalMode is omitted", async () => {
      const deps = makeDeps();
      const gate = new GovernanceGate(deps);

      const registration = makeRegistration();
      // approvalMode is optional on IntentRegistration; absent means "policy"
      delete (registration as { approvalMode?: string }).approvalMode;

      await gate.evaluate(makeWorkUnit(), registration);

      expect(deps.evaluate).toHaveBeenCalledOnce();
    });

    it("denies normally under policy mode when no policy matches (default-deny baseline)", async () => {
      // Confirm the existing default-deny semantics still hold for policy mode.
      const deps = makeDeps({
        evaluate: vi.fn().mockReturnValue(makeTrace({ finalDecision: "deny" })),
      });
      const gate = new GovernanceGate(deps);

      const decision = await gate.evaluate(
        makeWorkUnit(),
        makeRegistration({ approvalMode: "policy" }),
      );

      expect(decision.outcome).toBe("deny");
    });

    it("produces execute decision with empty matchedPolicies for system_auto_approved", async () => {
      const deps = makeDeps();
      const gate = new GovernanceGate(deps);

      const decision = await gate.evaluate(
        makeWorkUnit(),
        makeRegistration({ approvalMode: "system_auto_approved" }),
      );

      expect(decision.outcome).toBe("execute");
      if (decision.outcome === "execute") {
        expect(decision.matchedPolicies).toEqual([]);
        // Constraints still populated so downstream mode dispatch has a typed envelope.
        expect(decision.constraints).toBeDefined();
      }
    });
  });

  describe("SMB launch-posture trust override", () => {
    it("defaults constraints.trustLevel to 'guided' when no deployment override is set", async () => {
      const deps = makeDeps();
      const gate = new GovernanceGate(deps);

      const decision = await gate.evaluate(makeWorkUnit(), makeRegistration());

      expect(decision.outcome).toBe("execute");
      if (decision.outcome === "execute") {
        // Baseline (no override) is unchanged: DEFAULT_CARTRIDGE_CONSTRAINTS.trustLevel.
        expect(decision.constraints.trustLevel).toBe("guided");
      }
    });

    it("uses the deployment's trustLevelOverride for constraints when set (execute path)", async () => {
      const deps = makeDeps();
      const gate = new GovernanceGate(deps);
      const workUnit = makeWorkUnit({
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 0,
          trustLevelOverride: "autonomous",
        },
      });

      const decision = await gate.evaluate(workUnit, makeRegistration());

      expect(decision.outcome).toBe("execute");
      if (decision.outcome === "execute") {
        // Override flows into constraints → reaches GovernanceHook as ctx.trustLevel,
        // so external_mutation tool calls (bookings) auto-approve instead of parking.
        expect(decision.constraints.trustLevel).toBe("autonomous");
      }
    });

    it("carries the override into constraints on the require_approval path too", async () => {
      const deps = makeDeps({
        evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
      });
      const gate = new GovernanceGate(deps);
      const workUnit = makeWorkUnit({
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 0,
          trustLevelOverride: "autonomous",
        },
      });

      const decision = await gate.evaluate(workUnit, makeRegistration());

      expect(decision.outcome).toBe("require_approval");
      if (decision.outcome === "require_approval") {
        expect(decision.constraints?.trustLevel).toBe("autonomous");
      }
    });

    it("carries the override into the system_auto_approved short-circuit", async () => {
      const deps = makeDeps();
      const gate = new GovernanceGate(deps);
      const workUnit = makeWorkUnit({
        deployment: {
          deploymentId: "dep-1",
          skillSlug: "alex",
          trustLevel: "guided",
          trustScore: 0,
          trustLevelOverride: "autonomous",
        },
      });

      const decision = await gate.evaluate(
        workUnit,
        makeRegistration({ approvalMode: "system_auto_approved" }),
      );

      expect(decision.outcome).toBe("execute");
      if (decision.outcome === "execute") {
        expect(decision.constraints.trustLevel).toBe("autonomous");
      }
    });
  });
});

describe("GovernanceGate spend-approval threshold", () => {
  const autonomousWorkUnit = (parameters: Record<string, unknown>, threshold = 100) =>
    makeWorkUnit({
      intent: "digital-ads.campaign.adjust_budget",
      parameters,
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "riley",
        trustLevel: "guided",
        trustScore: 42,
        trustLevelOverride: "autonomous",
        spendAutonomyEnabled: true,
        policyOverrides: { spendApprovalThreshold: threshold },
      },
    });
  const budgetReg = (mutationClass: "write" | "destructive" = "write") =>
    makeRegistration({ intent: "digital-ads.campaign.adjust_budget", mutationClass });

  it("downgrades an under-threshold reversible budget approval to execute (autonomous)", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(autonomousWorkUnit({ budgetChange: 50 }), budgetReg());

    expect(decision.outcome).toBe("execute");
    expect(decision.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("parks an over-threshold budget action even when the engine would execute", async () => {
    const deps = makeDeps(); // default trace ⇒ execute
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(autonomousWorkUnit({ budgetChange: 500 }), budgetReg());

    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("keeps a deny denied under autonomous + under threshold (deny-floor independence)", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(
        makeTrace({
          finalDecision: "deny",
          checks: [
            {
              checkCode: "SPEND_LIMIT",
              checkData: {},
              humanDetail: "limit",
              matched: true,
              effect: "deny",
            },
          ],
        }),
      ),
    });
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(autonomousWorkUnit({ budgetChange: 50 }), budgetReg());

    expect(decision.outcome).toBe("deny");
  });

  it("does NOT downgrade an irreversible (destructive) action under threshold", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(
      autonomousWorkUnit({ budgetChange: 50 }),
      budgetReg("destructive"),
    );

    expect(decision.outcome).toBe("require_approval");
  });

  it("is dormant for an autonomous deployment that has NOT opted into spend autonomy", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);
    const wu = makeWorkUnit({
      intent: "digital-ads.campaign.adjust_budget",
      parameters: { budgetChange: 50 },
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "riley",
        trustLevel: "guided",
        trustScore: 42,
        trustLevelOverride: "autonomous",
        // spendAutonomyEnabled omitted ⇒ the always-$50 column default must NOT grant.
        policyOverrides: { spendApprovalThreshold: 100 },
      },
    });

    const decision = await gate.evaluate(wu, budgetReg());

    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("is dormant for a guided deployment (byte-identical to today)", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);
    const wu = makeWorkUnit({
      parameters: { budgetChange: 50 },
      deployment: {
        deploymentId: "dep-1",
        skillSlug: "riley",
        trustLevel: "guided",
        trustScore: 42,
        policyOverrides: { spendApprovalThreshold: 100 },
      },
    });

    const decision = await gate.evaluate(wu, budgetReg());

    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
  });

  it("is a no-op for a non-financial action under autonomous", async () => {
    const deps = makeDeps({
      evaluate: vi.fn().mockReturnValue(makeTrace({ approvalRequired: "standard" })),
    });
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(
      autonomousWorkUnit({ note: "no money here" }),
      budgetReg(),
    );

    expect(decision.outcome).toBe("require_approval");
    expect(decision.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
  });

  // F4 (security audit 2026-06-10): the auto-approve short-circuit returns
  // `execute` before the spend-approval threshold AND the hard spend floor. A
  // spend-bearing intent must therefore never reach it. This pair replaces the
  // prior test that pinned the exact anti-pattern (a `budgetChange: 500`
  // `system_auto_approved` intent returning `execute`).
  it("refuses to auto-approve a spend-bearing intent even if it bypassed register() (F4 defence in depth)", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);

    // Hand-constructed registration bypasses IntentRegistry.register()'s guard;
    // the gate must still refuse to route a spend-bearing budget mutation to execute.
    await expect(
      gate.evaluate(
        autonomousWorkUnit({ budgetChange: 500 }),
        makeRegistration({
          intent: "digital-ads.campaign.adjust_budget",
          mutationClass: "write",
          spendBearing: true,
          approvalMode: "system_auto_approved",
        }),
      ),
    ).rejects.toThrow(SpendBearingAutoApproveError);
  });

  it("leaves the short-circuit intact for a NON-spend-bearing auto-approved intent", async () => {
    const deps = makeDeps();
    const gate = new GovernanceGate(deps);

    const decision = await gate.evaluate(
      autonomousWorkUnit({ note: "no money here" }),
      makeRegistration({
        intent: "operator.transition_opportunity_stage",
        mutationClass: "write",
        approvalMode: "system_auto_approved",
        // spendBearing omitted ⇒ false ⇒ short-circuit still returns execute.
      }),
    );

    expect(decision.outcome).toBe("execute");
    expect(decision.matchedPolicies).not.toContain("SPEND_APPROVAL_THRESHOLD");
  });
});
