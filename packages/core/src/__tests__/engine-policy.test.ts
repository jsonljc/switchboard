import { describe, it, expect } from "vitest";

import { evaluate, createGuardrailState } from "../index.js";

import type { EvaluationContext, PolicyEngineContext, ResolvedIdentity } from "../index.js";

import type {
  RiskInput,
  IdentitySpec,
  Policy,
  GuardrailConfig,
  ActionProposal,
  CompositeRiskContext,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    globalSpendLimits: {
      daily: 10000,
      weekly: 50000,
      monthly: 200000,
      perAction: 5000,
    },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: ["account.delete"],
    trustBehaviors: ["campaign.read"],
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

// ===================================================================
// POLICY ENGINE
// ===================================================================

describe("Policy Engine", () => {
  it("forbidden behavior -> deny", () => {
    const identity = makeResolvedIdentity({
      effectiveForbiddenBehaviors: ["account.delete"],
    });
    const ctx = makeEvalContext({ actionType: "account.delete" });
    const proposal = makeProposal({ actionType: "account.delete" });
    const engineCtx = makeEngineContext({ resolvedIdentity: identity });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.explanation).toContain("Denied");
    expect(trace.checks.some((c) => c.checkCode === "FORBIDDEN_BEHAVIOR" && c.matched)).toBe(true);
  });

  it("trust behavior -> allow (fast path)", () => {
    const identity = makeResolvedIdentity({
      effectiveTrustBehaviors: ["campaign.read"],
    });
    const ctx = makeEvalContext({ actionType: "campaign.read" });
    const proposal = makeProposal({ actionType: "campaign.read" });
    const engineCtx = makeEngineContext({ resolvedIdentity: identity });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("none");
  });

  it("rate limit exceeded -> deny", () => {
    const guardrails: GuardrailConfig = {
      rateLimits: [{ scope: "global", maxActions: 5, windowMs: 60_000 }],
      cooldowns: [],
      protectedEntities: [],
    };
    const guardrailState = createGuardrailState();
    guardrailState.actionCounts.set("global", { count: 5, windowStart: Date.now() });

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({ guardrails, guardrailState });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "RATE_LIMIT" && c.matched)).toBe(true);
  });

  it("cooldown active -> deny", () => {
    const guardrails: GuardrailConfig = {
      rateLimits: [],
      cooldowns: [{ actionType: "campaign.update_budget", cooldownMs: 300_000, scope: "entity" }],
      protectedEntities: [],
    };
    const guardrailState = createGuardrailState();
    guardrailState.lastActionTimes.set("entity:entity-1", Date.now() - 60_000);

    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 500, entityId: "entity-1" } });
    const engineCtx = makeEngineContext({ guardrails, guardrailState });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "COOLDOWN" && c.matched)).toBe(true);
  });

  it("protected entity -> deny", () => {
    const guardrails: GuardrailConfig = {
      rateLimits: [],
      cooldowns: [],
      protectedEntities: [
        { entityType: "campaign", entityId: "protected-123", reason: "Critical campaign" },
      ],
    };
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { entityId: "protected-123" } });
    const engineCtx = makeEngineContext({ guardrails });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "PROTECTED_ENTITY" && c.matched)).toBe(true);
  });

  it("spend limit exceeded -> deny", () => {
    const identity = makeResolvedIdentity({
      effectiveSpendLimits: {
        daily: 10000,
        weekly: 50000,
        monthly: 200000,
        perAction: 1000,
      },
    });
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 5000 } });
    const engineCtx = makeEngineContext({ resolvedIdentity: identity });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "SPEND_LIMIT" && c.matched)).toBe(true);
  });

  it("policy rule match -> apply deny effect", () => {
    const denyPolicy = makePolicy({
      id: "deny-policy",
      name: "Block large budgets",
      priority: 1,
      effect: "deny",
      rule: {
        composition: "AND",
        conditions: [{ field: "actionType", operator: "eq", value: "campaign.update_budget" }],
      },
    });

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({ policies: [denyPolicy] });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(
      trace.checks.some((c) => c.checkCode === "POLICY_RULE" && c.matched && c.effect === "deny"),
    ).toBe(true);
  });

  it("risk scoring determines approval requirement", () => {
    const identity = makeResolvedIdentity({
      effectiveRiskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
    });
    const riskInput = makeRiskInput({
      baseRisk: "high",
      exposure: { dollarsAtRisk: 5000, blastRadius: 1 },
    });

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({ resolvedIdentity: identity, riskInput });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(["standard", "elevated", "mandatory"]).toContain(trace.approvalRequired);
  });

  it("default deny when no policies match", () => {
    const identity = makeResolvedIdentity({
      effectiveTrustBehaviors: [],
      effectiveForbiddenBehaviors: [],
    });
    const ctx = makeEvalContext({ actionType: "unknown.action" });
    const proposal = makeProposal({ actionType: "unknown.action" });
    const engineCtx = makeEngineContext({
      resolvedIdentity: identity,
      policies: [],
    });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
  });

  it("require_approval policy sets policyDecision to allow", () => {
    const approvalPolicy = makePolicy({
      id: "require-approval-policy",
      name: "Require approval for budget",
      priority: 1,
      effect: "require_approval",
      approvalRequirement: "elevated",
      rule: {
        composition: "AND",
        conditions: [{ field: "actionType", operator: "eq", value: "campaign.update_budget" }],
      },
    });

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({ policies: [approvalPolicy] });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("elevated");
  });
});

// ===================================================================
// POLICY ENGINE — SPEND LIMITS (time-windowed)
// ===================================================================

describe("Policy Engine — Spend Limits", () => {
  it("daily spend limit exceeded -> deny", () => {
    const identity = makeResolvedIdentity({
      effectiveSpendLimits: {
        daily: 5000,
        weekly: null,
        monthly: null,
        perAction: 10000,
      },
    });
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 1000 } });
    const engineCtx = makeEngineContext({
      resolvedIdentity: identity,
      spendLookup: { dailySpend: 4500, weeklySpend: 4500, monthlySpend: 4500 },
    });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    const dailyCheck = trace.checks.find(
      (c) => c.checkCode === "SPEND_LIMIT" && c.matched && c.checkData["field"] === "daily",
    );
    expect(dailyCheck).toBeDefined();
    expect(dailyCheck!.humanDetail).toContain("daily");
  });

  it("weekly spend limit exceeded -> deny", () => {
    const identity = makeResolvedIdentity({
      effectiveSpendLimits: {
        daily: null,
        weekly: 20000,
        monthly: null,
        perAction: 10000,
      },
    });
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 5000 } });
    const engineCtx = makeEngineContext({
      resolvedIdentity: identity,
      spendLookup: { dailySpend: 5000, weeklySpend: 18000, monthlySpend: 18000 },
    });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    const weeklyCheck = trace.checks.find(
      (c) => c.checkCode === "SPEND_LIMIT" && c.matched && c.checkData["field"] === "weekly",
    );
    expect(weeklyCheck).toBeDefined();
  });

  it("monthly spend limit exceeded -> deny", () => {
    const identity = makeResolvedIdentity({
      effectiveSpendLimits: {
        daily: null,
        weekly: null,
        monthly: 50000,
        perAction: 10000,
      },
    });
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 2000 } });
    const engineCtx = makeEngineContext({
      resolvedIdentity: identity,
      spendLookup: { dailySpend: 2000, weeklySpend: 10000, monthlySpend: 49000 },
    });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    const monthlyCheck = trace.checks.find(
      (c) => c.checkCode === "SPEND_LIMIT" && c.matched && c.checkData["field"] === "monthly",
    );
    expect(monthlyCheck).toBeDefined();
  });

  it("time-windowed spend within limits -> allow", () => {
    const identity = makeResolvedIdentity({
      effectiveSpendLimits: {
        daily: 10000,
        weekly: 50000,
        monthly: 200000,
        perAction: 5000,
      },
    });
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 1000 } });
    const engineCtx = makeEngineContext({
      resolvedIdentity: identity,
      spendLookup: { dailySpend: 2000, weeklySpend: 10000, monthlySpend: 30000 },
    });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny"); // no policies match -> default deny
    const spendChecks = trace.checks.filter(
      (c) => c.checkCode === "SPEND_LIMIT" && c.matched && c.effect === "deny",
    );
    expect(spendChecks).toHaveLength(0);
  });

  it("no spendLookup provided -> skips time-windowed checks", () => {
    const identity = makeResolvedIdentity({
      effectiveSpendLimits: {
        daily: 1000,
        weekly: 5000,
        monthly: 20000,
        perAction: 10000,
      },
    });
    const ctx = makeEvalContext();
    const proposal = makeProposal({ parameters: { amount: 500 } });
    const engineCtx = makeEngineContext({ resolvedIdentity: identity });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    const dailyCheck = trace.checks.find(
      (c) => c.checkCode === "SPEND_LIMIT" && c.checkData["field"] === "daily",
    );
    expect(dailyCheck).toBeUndefined();
  });
});

// ===================================================================
// POLICY ENGINE — COMPOSITE RISK
// ===================================================================

describe("Policy Engine — Composite Risk", () => {
  it("COMPOSITE_RISK check appears in trace when compositeContext is present", () => {
    const compositeContext: CompositeRiskContext = {
      recentActionCount: 5,
      windowMs: 3600000,
      cumulativeExposure: 1000,
      distinctTargetEntities: 3,
      distinctCartridges: 1,
    };

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({ compositeContext });

    const trace = evaluate(proposal, ctx, engineCtx);
    const compositeCheck = trace.checks.find((c) => c.checkCode === "COMPOSITE_RISK");
    expect(compositeCheck).toBeDefined();
  });

  it("no COMPOSITE_RISK check when compositeContext is absent", () => {
    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext();

    const trace = evaluate(proposal, ctx, engineCtx);
    const compositeCheck = trace.checks.find((c) => c.checkCode === "COMPOSITE_RISK");
    expect(compositeCheck).toBeUndefined();
  });

  it("composite risk bumps category -> changes approval requirement", () => {
    const identity = makeResolvedIdentity({
      effectiveRiskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
    });

    const riskInput = makeRiskInput({
      baseRisk: "medium",
    });

    const compositeContext: CompositeRiskContext = {
      recentActionCount: 50,
      windowMs: 3600000,
      cumulativeExposure: 50000,
      distinctTargetEntities: 2,
      distinctCartridges: 5,
    };

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({
      resolvedIdentity: identity,
      riskInput,
      compositeContext,
    });

    const trace = evaluate(proposal, ctx, engineCtx);

    const compositeCheck = trace.checks.find((c) => c.checkCode === "COMPOSITE_RISK");
    expect(compositeCheck).toBeDefined();
    expect(compositeCheck!.matched).toBe(true);

    expect(trace.computedRiskScore.rawScore).toBeGreaterThan(35);
  });
});
