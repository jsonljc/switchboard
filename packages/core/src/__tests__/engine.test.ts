import { describe, it, expect } from "vitest";

import {
  evaluateRule,
  computeRiskScore,
  DEFAULT_RISK_CONFIG,
  createTraceBuilder,
  addCheck,
  buildTrace,
  resolveEntities,
  buildClarificationQuestion,
  buildNotFoundExplanation,
  evaluatePlan,
  evaluate,
  createGuardrailState,
  resolveIdentity,
  getActiveOverlays,
  createApprovalState,
  transitionApproval,
  isExpired,
  computeBindingHash,
  validateBindingHash,
  hashObject,
  computeAuditHashSync,
  sha256,
  verifyChain,
  redactSnapshot,
  DEFAULT_REDACTION_CONFIG,
  storeEvidence,
  verifyEvidence,
  AuditLedger,
  InMemoryLedgerStorage,
} from "../index.js";

import type {
  EvaluationContext,
  EntityResolver,
  PolicyEngineContext,
  ResolvedIdentity,
  AuditHashInput,
} from "../index.js";

import type {
  PolicyRule,
  RiskInput,
  ActionPlan,
  DecisionTrace,
  ResolvedEntity,
  IdentitySpec,
  RoleOverlay,
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

function makeOverlay(overrides: Partial<RoleOverlay> = {}): RoleOverlay {
  return {
    id: "overlay-1",
    identitySpecId: "spec-1",
    name: "Test Overlay",
    description: "A test overlay",
    mode: "restrict",
    priority: 0,
    active: true,
    conditions: {},
    overrides: {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

// ===================================================================
// RULE EVALUATOR
// ===================================================================

describe("Rule Evaluator", () => {
  const ctx = makeEvalContext();

  it("eq: matches when field equals expected value", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "eq", value: "campaign.update_budget" }],
    };
    const result = evaluateRule(rule, ctx);
    expect(result.matched).toBe(true);
    expect(result.conditionResults[0]?.matched).toBe(true);
  });

  it("eq: does not match when field differs", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "eq", value: "account.delete" }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(false);
  });

  it("neq: matches when field does not equal expected value", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "neq", value: "account.delete" }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("gt: matches when numeric field is greater", () => {
    const ruleCtx = makeEvalContext({ parameters: { amount: 1000 } });
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "parameters.amount", operator: "gt", value: 500 }],
    };
    expect(evaluateRule(rule, ruleCtx).matched).toBe(true);
  });

  it("gte: matches when field equals threshold", () => {
    const ruleCtx = makeEvalContext({ parameters: { amount: 500 } });
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "parameters.amount", operator: "gte", value: 500 }],
    };
    expect(evaluateRule(rule, ruleCtx).matched).toBe(true);
  });

  it("lt: matches when field is less than threshold", () => {
    const ruleCtx = makeEvalContext({ parameters: { amount: 100 } });
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "parameters.amount", operator: "lt", value: 500 }],
    };
    expect(evaluateRule(rule, ruleCtx).matched).toBe(true);
  });

  it("lte: matches when field equals threshold", () => {
    const ruleCtx = makeEvalContext({ parameters: { amount: 500 } });
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "parameters.amount", operator: "lte", value: 500 }],
    };
    expect(evaluateRule(rule, ruleCtx).matched).toBe(true);
  });

  it("in: matches when field is in the expected array", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "cartridgeId", operator: "in", value: ["google-ads", "meta-ads"] },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("not_in: matches when field is not in the expected array", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "cartridgeId", operator: "not_in", value: ["meta-ads", "tiktok-ads"] },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("contains: matches when string field includes substring", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "contains", value: "update" },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("matches: matches when string field matches regex", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "matches", value: "^campaign\\." },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("exists: matches when field is present and non-null", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "cartridgeId", operator: "exists", value: null }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("not_exists: matches when field is undefined", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "parameters.missing_field", operator: "not_exists", value: null }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("AND composition: requires all conditions to match", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "campaign.update_budget" },
        { field: "cartridgeId", operator: "eq", value: "google-ads" },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);

    const failRule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "campaign.update_budget" },
        { field: "cartridgeId", operator: "eq", value: "meta-ads" },
      ],
    };
    expect(evaluateRule(failRule, ctx).matched).toBe(false);
  });

  it("OR composition: matches if any condition matches", () => {
    const rule: PolicyRule = {
      composition: "OR",
      conditions: [
        { field: "cartridgeId", operator: "eq", value: "meta-ads" },
        { field: "cartridgeId", operator: "eq", value: "google-ads" },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("NOT composition: inverts the inner result", () => {
    const rule: PolicyRule = {
      composition: "NOT",
      conditions: [
        { field: "actionType", operator: "eq", value: "account.delete" },
      ],
    };
    // Inner is false (does not match), so NOT makes it true
    expect(evaluateRule(rule, ctx).matched).toBe(true);

    const ruleMatching: PolicyRule = {
      composition: "NOT",
      conditions: [
        { field: "actionType", operator: "eq", value: "campaign.update_budget" },
      ],
    };
    // Inner is true, so NOT makes it false
    expect(evaluateRule(ruleMatching, ctx).matched).toBe(false);
  });

  it("nested path evaluation: resolves dot-separated paths", () => {
    const ruleCtx = makeEvalContext({ parameters: { amount: 750 } });
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "parameters.amount", operator: "gte", value: 500 },
      ],
    };
    expect(evaluateRule(rule, ruleCtx).matched).toBe(true);
  });

  it("empty conditions: AND composition with no conditions matches (vacuous truth)", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("nested child rules: evaluates children recursively", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [
        { field: "actionType", operator: "eq", value: "campaign.update_budget" },
      ],
      children: [
        {
          composition: "OR",
          conditions: [
            { field: "cartridgeId", operator: "eq", value: "meta-ads" },
            { field: "cartridgeId", operator: "eq", value: "google-ads" },
          ],
        },
      ],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });
});

// ===================================================================
// RISK SCORER
// ===================================================================

describe("Risk Scorer", () => {
  it("base risk contribution only", () => {
    const input = makeRiskInput({ baseRisk: "medium" });
    const result = computeRiskScore(input);
    const baseFactor = result.factors.find((f) => f.factor === "base_risk");
    expect(baseFactor?.contribution).toBe(DEFAULT_RISK_CONFIG.baseWeights.medium);
    expect(result.rawScore).toBeGreaterThanOrEqual(35);
  });

  it("dollar exposure contribution", () => {
    const input = makeRiskInput({
      baseRisk: "none",
      exposure: { dollarsAtRisk: 5000, blastRadius: 1 },
    });
    const result = computeRiskScore(input);
    const dollarFactor = result.factors.find((f) => f.factor === "dollars_at_risk");
    // 5000/10000 * 20 = 10
    expect(dollarFactor?.contribution).toBe(10);
  });

  it("blast radius contribution (logarithmic)", () => {
    const input = makeRiskInput({
      baseRisk: "none",
      exposure: { dollarsAtRisk: 0, blastRadius: 8 },
    });
    const result = computeRiskScore(input);
    const blastFactor = result.factors.find((f) => f.factor === "blast_radius");
    // log2(8) = 3, weight=10, contribution = 10*3 = 30, capped at 20
    expect(blastFactor).toBeDefined();
    expect(blastFactor!.contribution).toBe(20); // capped at blastRadiusWeight * 2
  });

  it("irreversibility penalty: none -> full penalty", () => {
    const input = makeRiskInput({ baseRisk: "none", reversibility: "none" });
    const result = computeRiskScore(input);
    const irrevFactor = result.factors.find((f) => f.factor === "irreversibility");
    expect(irrevFactor?.contribution).toBe(DEFAULT_RISK_CONFIG.irreversibilityPenalty);
  });

  it("irreversibility penalty: partial -> half penalty", () => {
    const input = makeRiskInput({ baseRisk: "none", reversibility: "partial" });
    const result = computeRiskScore(input);
    const partialFactor = result.factors.find((f) => f.factor === "partial_reversibility");
    expect(partialFactor?.contribution).toBe(DEFAULT_RISK_CONFIG.irreversibilityPenalty * 0.5);
  });

  it("irreversibility: full -> no penalty", () => {
    const input = makeRiskInput({ baseRisk: "none", reversibility: "full" });
    const result = computeRiskScore(input);
    const irrevFactor = result.factors.find(
      (f) => f.factor === "irreversibility" || f.factor === "partial_reversibility",
    );
    expect(irrevFactor).toBeUndefined();
  });

  it("full scoring with all sensitivity flags", () => {
    const input = makeRiskInput({
      baseRisk: "high",
      exposure: { dollarsAtRisk: 10000, blastRadius: 4 },
      reversibility: "none",
      sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
    });
    const result = computeRiskScore(input);
    expect(result.factors.some((f) => f.factor === "entity_volatile")).toBe(true);
    expect(result.factors.some((f) => f.factor === "learning_phase")).toBe(true);
    expect(result.factors.some((f) => f.factor === "recently_modified")).toBe(true);
    // Score should be very high with all penalties
    expect(result.rawScore).toBeGreaterThan(80);
  });

  it("score capping at 100", () => {
    const input = makeRiskInput({
      baseRisk: "critical",
      exposure: { dollarsAtRisk: 100000, blastRadius: 1024 },
      reversibility: "none",
      sensitivity: { entityVolatile: true, learningPhase: true, recentlyModified: true },
    });
    const result = computeRiskScore(input);
    expect(result.rawScore).toBeLessThanOrEqual(100);
    expect(result.rawScore).toBe(100);
  });

  it("category mapping: 0-20=none, 21-40=low, 41-60=medium, 61-80=high, 81-100=critical", () => {
    // none: baseRisk "none" = 0 score
    const noneResult = computeRiskScore(makeRiskInput({ baseRisk: "none" }));
    expect(noneResult.category).toBe("none");

    // low: baseRisk "low" = 15 score
    const lowResult = computeRiskScore(makeRiskInput({ baseRisk: "low" }));
    expect(lowResult.category).toBe("none"); // 15 <= 20 => "none"

    // medium: baseRisk "medium" = 35 score
    const medResult = computeRiskScore(makeRiskInput({ baseRisk: "medium" }));
    expect(medResult.category).toBe("low"); // 35 is in 21-40 range

    // high: baseRisk "high" = 55 score
    const highResult = computeRiskScore(makeRiskInput({ baseRisk: "high" }));
    expect(highResult.category).toBe("medium"); // 55 is in 41-60 range

    // critical: baseRisk "critical" = 80 score
    const critResult = computeRiskScore(makeRiskInput({ baseRisk: "critical" }));
    expect(critResult.category).toBe("high"); // 80 is in 61-80 range
  });
});

// ===================================================================
// IDENTITY + OVERLAY MERGING
// ===================================================================

describe("Identity + Overlay Merging", () => {
  it("base identity without overlays", () => {
    const spec = makeBaseIdentitySpec();
    const result = resolveIdentity(spec, [], {});
    expect(result.effectiveRiskTolerance).toEqual(spec.riskTolerance);
    expect(result.effectiveSpendLimits).toEqual(spec.globalSpendLimits);
    expect(result.effectiveForbiddenBehaviors).toEqual(["account.delete"]);
    expect(result.effectiveTrustBehaviors).toEqual(["campaign.read"]);
    expect(result.activeOverlays).toHaveLength(0);
  });

  it("restrictive overlay merging: takes more restrictive approval requirement", () => {
    const spec = makeBaseIdentitySpec({
      riskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
    });
    const overlay = makeOverlay({
      mode: "restrict",
      overrides: {
        riskTolerance: {
          none: "none",
          low: "standard",       // more restrictive than "none"
          medium: "elevated",    // more restrictive than "standard"
          high: "mandatory",     // more restrictive than "elevated"
          critical: "mandatory",
        },
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveRiskTolerance.low).toBe("standard");
    expect(result.effectiveRiskTolerance.medium).toBe("elevated");
    expect(result.effectiveRiskTolerance.high).toBe("mandatory");
  });

  it("permissive overlay merging: takes less restrictive approval requirement", () => {
    const spec = makeBaseIdentitySpec({
      riskTolerance: {
        none: "none",
        low: "standard",
        medium: "elevated",
        high: "mandatory",
        critical: "mandatory",
      },
    });
    const overlay = makeOverlay({
      mode: "extend",
      overrides: {
        riskTolerance: {
          none: "none",
          low: "none",          // less restrictive
          medium: "standard",   // less restrictive
          high: "elevated",     // less restrictive
          critical: "mandatory",
        },
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveRiskTolerance.low).toBe("none");
    expect(result.effectiveRiskTolerance.medium).toBe("standard");
    expect(result.effectiveRiskTolerance.high).toBe("elevated");
  });

  it("additional forbidden behaviors overlay", () => {
    const spec = makeBaseIdentitySpec({ forbiddenBehaviors: ["account.delete"] });
    const overlay = makeOverlay({
      overrides: {
        additionalForbiddenBehaviors: ["campaign.pause_all", "billing.change_card"],
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveForbiddenBehaviors).toContain("account.delete");
    expect(result.effectiveForbiddenBehaviors).toContain("campaign.pause_all");
    expect(result.effectiveForbiddenBehaviors).toContain("billing.change_card");
  });

  it("remove trust behaviors overlay", () => {
    const spec = makeBaseIdentitySpec({
      trustBehaviors: ["campaign.read", "campaign.update_budget", "report.view"],
    });
    const overlay = makeOverlay({
      overrides: {
        removeTrustBehaviors: ["campaign.update_budget"],
      },
    });
    const result = resolveIdentity(spec, [overlay], {});
    expect(result.effectiveTrustBehaviors).toContain("campaign.read");
    expect(result.effectiveTrustBehaviors).not.toContain("campaign.update_budget");
    expect(result.effectiveTrustBehaviors).toContain("report.view");
  });

  it("time window filtering: overlay only active during matching time", () => {
    const spec = makeBaseIdentitySpec();
    // Create a time window for the current day/hour
    const now = new Date("2025-06-15T14:30:00Z"); // Sunday=0, but this is a Sunday
    const dayOfWeek = now.getDay(); // 0 for Sunday
    const hour = now.getHours();    // 14

    const activeOverlay = makeOverlay({
      id: "overlay-active",
      conditions: {
        timeWindows: [{ dayOfWeek: [dayOfWeek], startHour: hour, endHour: hour + 1, timezone: "UTC" }],
      },
      overrides: { additionalForbiddenBehaviors: ["test.action"] },
    });

    const inactiveOverlay = makeOverlay({
      id: "overlay-inactive",
      conditions: {
        timeWindows: [{ dayOfWeek: [dayOfWeek], startHour: hour + 5, endHour: hour + 6, timezone: "UTC" }],
      },
      overrides: { additionalForbiddenBehaviors: ["other.action"] },
    });

    const result = resolveIdentity(spec, [activeOverlay, inactiveOverlay], { now });
    expect(result.activeOverlays).toHaveLength(1);
    expect(result.activeOverlays[0]?.id).toBe("overlay-active");
    expect(result.effectiveForbiddenBehaviors).toContain("test.action");
    expect(result.effectiveForbiddenBehaviors).not.toContain("other.action");
  });

  it("cartridge filtering: overlay only active for matching cartridge", () => {
    const spec = makeBaseIdentitySpec();
    const overlay = makeOverlay({
      conditions: {
        cartridgeIds: ["meta-ads"],
      },
      overrides: { additionalForbiddenBehaviors: ["meta.action"] },
    });

    // Does not match
    const result1 = resolveIdentity(spec, [overlay], { cartridgeId: "google-ads" });
    expect(result1.activeOverlays).toHaveLength(0);

    // Matches
    const result2 = resolveIdentity(spec, [overlay], { cartridgeId: "meta-ads" });
    expect(result2.activeOverlays).toHaveLength(1);
    expect(result2.effectiveForbiddenBehaviors).toContain("meta.action");
  });
});

// ===================================================================
// getActiveOverlays
// ===================================================================

describe("getActiveOverlays", () => {
  it("returns only active overlays sorted by priority", () => {
    const o1 = makeOverlay({ id: "o1", priority: 10, active: true });
    const o2 = makeOverlay({ id: "o2", priority: 5, active: true });
    const o3 = makeOverlay({ id: "o3", priority: 1, active: false }); // inactive

    const result = getActiveOverlays([o1, o2, o3], {});
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("o2"); // priority 5
    expect(result[1]?.id).toBe("o1"); // priority 10
  });
});

// ===================================================================
// DECISION TRACE BUILDER
// ===================================================================

describe("Decision Trace Builder", () => {
  it("builds trace with a deny check", () => {
    const builder = createTraceBuilder("env-1", "action-1");
    addCheck(builder, "FORBIDDEN_BEHAVIOR", { behavior: "delete" }, "Forbidden", true, "deny");
    builder.computedRiskScore = {
      rawScore: 50,
      category: "medium",
      factors: [],
    };

    const trace = buildTrace(builder);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.explanation).toContain("Denied");
    expect(trace.checks).toHaveLength(1);
  });

  it("builds trace with allow when no deny checks match", () => {
    const builder = createTraceBuilder("env-1", "action-2");
    addCheck(builder, "TRUST_BEHAVIOR", {}, "Trusted action", true, "allow");
    addCheck(builder, "POLICY_RULE", {}, "Policy not matched", false, "skip");
    builder.computedRiskScore = {
      rawScore: 10,
      category: "none",
      factors: [],
    };

    const trace = buildTrace(builder);
    expect(trace.finalDecision).toBe("allow");
    expect(trace.explanation).toBe("Action allowed.");
  });

  it("generates explanation for pending approval", () => {
    const builder = createTraceBuilder("env-1", "action-3");
    addCheck(builder, "RISK_SCORING", {}, "Risk scored", true, "skip");
    builder.computedRiskScore = {
      rawScore: 60,
      category: "medium",
      factors: [],
    };
    builder.approvalRequired = "elevated";

    const trace = buildTrace(builder);
    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("elevated");
    expect(trace.explanation).toContain("elevated");
  });

  it("throws if risk score is not set", () => {
    const builder = createTraceBuilder("env-1", "action-4");
    expect(() => buildTrace(builder)).toThrow("Cannot build trace without computed risk score");
  });
});

// ===================================================================
// APPROVAL STATE MACHINE
// ===================================================================

describe("Approval State Machine", () => {
  it("creates a pending state", () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const state = createApprovalState(expiresAt);
    expect(state.status).toBe("pending");
    expect(state.respondedBy).toBeNull();
    expect(state.patchValue).toBeNull();
    expect(state.expiresAt).toBe(expiresAt);
  });

  it("transitions to approved", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const approved = transitionApproval(state, "approve", "admin-1");
    expect(approved.status).toBe("approved");
    expect(approved.respondedBy).toBe("admin-1");
    expect(approved.respondedAt).toBeInstanceOf(Date);
  });

  it("transitions to rejected", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const rejected = transitionApproval(state, "reject", "admin-1");
    expect(rejected.status).toBe("rejected");
    expect(rejected.respondedBy).toBe("admin-1");
  });

  it("transitions to patched with patch value", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const patched = transitionApproval(state, "patch", "admin-1", { amount: 100 });
    expect(patched.status).toBe("patched");
    expect(patched.patchValue).toEqual({ amount: 100 });
  });

  it("throws when approving a non-pending state", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const approved = transitionApproval(state, "approve", "admin-1");
    expect(() => transitionApproval(approved, "approve", "admin-2")).toThrow(
      "Cannot approve: current status is approved",
    );
  });

  it("throws when rejecting a non-pending state", () => {
    const state = createApprovalState(new Date(Date.now() + 3600_000));
    const rejected = transitionApproval(state, "reject", "admin-1");
    expect(() => transitionApproval(rejected, "reject", "admin-2")).toThrow(
      "Cannot reject: current status is rejected",
    );
  });

  it("expiry check: isExpired returns true when past expiresAt", () => {
    const pastExpiry = new Date(Date.now() - 1000);
    const state = createApprovalState(pastExpiry);
    expect(isExpired(state)).toBe(true);
  });

  it("expiry check: isExpired returns false when before expiresAt", () => {
    const futureExpiry = new Date(Date.now() + 3600_000);
    const state = createApprovalState(futureExpiry);
    expect(isExpired(state)).toBe(false);
  });
});

// ===================================================================
// BINDING HASH
// ===================================================================

describe("Binding Hash", () => {
  const bindingData = {
    envelopeId: "env-1",
    envelopeVersion: 1,
    actionId: "action-1",
    parameters: { amount: 500 },
    decisionTraceHash: "abc123",
    contextSnapshotHash: "def456",
  };

  it("computes binding hash deterministically", () => {
    const hash1 = computeBindingHash(bindingData);
    const hash2 = computeBindingHash(bindingData);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it("validates matching hash", () => {
    const hash = computeBindingHash(bindingData);
    expect(validateBindingHash(hash, bindingData)).toBe(true);
  });

  it("rejects stale hash when version differs", () => {
    const hash = computeBindingHash(bindingData);
    const modifiedData = { ...bindingData, envelopeVersion: 2 };
    expect(validateBindingHash(hash, modifiedData)).toBe(false);
  });

  it("rejects hash when parameters change", () => {
    const hash = computeBindingHash(bindingData);
    const modifiedData = { ...bindingData, parameters: { amount: 999 } };
    expect(validateBindingHash(hash, modifiedData)).toBe(false);
  });
});

// ===================================================================
// AUDIT: CANONICAL HASH + CHAIN VERIFICATION
// ===================================================================

describe("Audit", () => {
  const baseHashInput: AuditHashInput = {
    chainHashVersion: 1,
    schemaVersion: 1,
    id: "audit-1",
    eventType: "action.evaluated",
    timestamp: "2025-01-15T10:00:00.000Z",
    actorType: "agent",
    actorId: "agent-1",
    entityType: "campaign",
    entityId: "campaign-123",
    riskCategory: "medium",
    snapshot: { budget: 500 },
    evidencePointers: [],
    summary: "Evaluated budget change",
    previousEntryHash: null,
  };

  it("canonical hash determinism: same input produces same hash", () => {
    const hash1 = computeAuditHashSync(baseHashInput);
    const hash2 = computeAuditHashSync(baseHashInput);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("canonical hash changes when input changes", () => {
    const hash1 = computeAuditHashSync(baseHashInput);
    const hash2 = computeAuditHashSync({ ...baseHashInput, summary: "Different summary" });
    expect(hash1).not.toBe(hash2);
  });

  it("hash chain verification: valid chain", () => {
    // Build valid chain entries with proper hashes (matching ledger behavior)
    const hashInput1: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id: "chain-1",
      eventType: "action.evaluated",
      timestamp: "2025-01-15T10:00:00.000Z",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      snapshot: { a: 1 },
      evidencePointers: [],
      summary: "Entry 1",
      previousEntryHash: null,
    };
    const hash1 = computeAuditHashSync(hashInput1);

    const hashInput2: AuditHashInput = {
      ...hashInput1,
      id: "chain-2",
      summary: "Entry 2",
      previousEntryHash: hash1,
    };
    const hash2 = computeAuditHashSync(hashInput2);

    const result = verifyChain([
      { ...hashInput1, entryHash: hash1 },
      { ...hashInput2, entryHash: hash2 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("hash chain break detection", () => {
    // Build entries with valid hashes but broken linkage
    const hashInput1: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id: "break-1",
      eventType: "action.evaluated",
      timestamp: "2025-01-15T10:00:00.000Z",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      snapshot: { a: 1 },
      evidencePointers: [],
      summary: "Entry 1",
      previousEntryHash: null,
    };
    const hash1 = computeAuditHashSync(hashInput1);

    const hashInput2: AuditHashInput = {
      ...hashInput1,
      id: "break-2",
      summary: "Entry 2",
      previousEntryHash: hash1,
    };
    const hash2 = computeAuditHashSync(hashInput2);

    // Entry 3 has previousEntryHash = "WRONG" instead of hash2
    const hashInput3: AuditHashInput = {
      ...hashInput1,
      id: "break-3",
      summary: "Entry 3",
      previousEntryHash: "WRONG",
    };
    const hash3 = computeAuditHashSync(hashInput3);

    const result = verifyChain([
      { ...hashInput1, entryHash: hash1 },
      { ...hashInput2, entryHash: hash2 },
      { ...hashInput3, entryHash: hash3 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("verifyChain catches tampered entry data", () => {
    // Create valid hash inputs (without entryHash, matching ledger behavior)
    const hashInput1: AuditHashInput = {
      chainHashVersion: 1,
      schemaVersion: 1,
      id: "audit-tamper-1",
      eventType: "action.evaluated",
      timestamp: "2025-01-15T10:00:00.000Z",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "campaign-1",
      riskCategory: "low",
      snapshot: { budget: 500 },
      evidencePointers: [],
      summary: "Original entry",
      previousEntryHash: null,
    };
    const hash1 = computeAuditHashSync(hashInput1);

    const hashInput2: AuditHashInput = {
      ...hashInput1,
      id: "audit-tamper-2",
      summary: "Second entry",
      previousEntryHash: hash1,
    };
    const hash2 = computeAuditHashSync(hashInput2);

    const entry1 = { ...hashInput1, entryHash: hash1 };
    const entry2 = { ...hashInput2, entryHash: hash2 };

    // Valid chain should pass
    expect(verifyChain([entry1, entry2]).valid).toBe(true);

    // Tamper with entry1's snapshot data but keep its old hash
    const tampered1 = { ...entry1, snapshot: { budget: 999999 } };
    expect(verifyChain([tampered1, entry2]).valid).toBe(false);
    expect(verifyChain([tampered1, entry2]).brokenAt).toBe(0);
  });

  it("redaction of email patterns", () => {
    const snapshot = { email: "user@example.com", name: "John" };
    const result = redactSnapshot(snapshot);
    expect(result.redacted["email"]).toBe("[REDACTED]");
    expect(result.redacted["name"]).toBe("John");
    expect(result.redactionApplied).toBe(true);
    expect(result.redactedFields).toContain("email");
  });

  it("redaction of API tokens", () => {
    const snapshot = { config: "Bearer sk-abcdefghijklmnopqrstuv" };
    const result = redactSnapshot(snapshot);
    expect(result.redacted["config"]).toContain("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
  });

  it("redaction of field paths (e.g., 'password', 'secret')", () => {
    const snapshot = { password: "super-secret", apiKey: "my-key", normal: "value" };
    const result = redactSnapshot(snapshot);
    expect(result.redacted["password"]).toBe("[REDACTED]");
    expect(result.redacted["apiKey"]).toBe("[REDACTED]");
    expect(result.redacted["normal"]).toBe("value");
  });

  it("no redaction when snapshot is clean", () => {
    const snapshot = { name: "Campaign Alpha", budget: 500 };
    const result = redactSnapshot(snapshot);
    expect(result.redactionApplied).toBe(false);
    expect(result.redactedFields).toHaveLength(0);
  });
});

// ===================================================================
// EVIDENCE STORAGE
// ===================================================================

describe("Evidence Storage", () => {
  it("stores small evidence inline", () => {
    const evidence = { key: "value" };
    const pointer = storeEvidence(evidence);
    expect(pointer.type).toBe("inline");
    expect(pointer.storageRef).toBeNull();
    expect(pointer.hash).toHaveLength(64);
  });

  it("stores large evidence as pointer", () => {
    // Create evidence larger than 10KB
    const largeData = { data: "x".repeat(11_000) };
    const pointer = storeEvidence(largeData, "s3://bucket");
    expect(pointer.type).toBe("pointer");
    expect(pointer.storageRef).toContain("s3://bucket");
    expect(pointer.hash).toHaveLength(64);
  });

  it("verifyEvidence returns true for matching content", () => {
    const evidence = { action: "budget_change", amount: 500 };
    const pointer = storeEvidence(evidence);
    expect(verifyEvidence(evidence, pointer.hash)).toBe(true);
  });

  it("verifyEvidence returns false for tampered content", () => {
    const evidence = { action: "budget_change", amount: 500 };
    const pointer = storeEvidence(evidence);
    const tampered = { action: "budget_change", amount: 999 };
    expect(verifyEvidence(tampered, pointer.hash)).toBe(false);
  });
});

// ===================================================================
// ACTION PLAN EVALUATOR
// ===================================================================

describe("ActionPlan Evaluator", () => {
  function makeTrace(actionId: string, decision: "allow" | "deny" | "modify"): DecisionTrace {
    return {
      actionId,
      envelopeId: "env-1",
      checks: [],
      computedRiskScore: { rawScore: 30, category: "low", factors: [] },
      finalDecision: decision,
      approvalRequired: "none",
      explanation: `Action ${decision}`,
      evaluatedAt: new Date(),
    };
  }

  it("atomic: any denial denies all", () => {
    const plan: ActionPlan = {
      id: "plan-1",
      envelopeId: "env-1",
      strategy: "atomic",
      approvalMode: "per_action",
      summary: "Test plan",
      proposalOrder: ["a1", "a2", "a3"],
    };
    const decisions = [
      makeTrace("a1", "allow"),
      makeTrace("a2", "deny"),
      makeTrace("a3", "allow"),
    ];

    const result = evaluatePlan(plan, decisions);
    expect(result.planDecision).toBe("deny");
    // In atomic mode, all get denied
    expect(result.perProposal.get("a1")).toBe("deny");
    expect(result.perProposal.get("a2")).toBe("deny");
    expect(result.perProposal.get("a3")).toBe("deny");
  });

  it("atomic: all allowed passes", () => {
    const plan: ActionPlan = {
      id: "plan-1",
      envelopeId: "env-1",
      strategy: "atomic",
      approvalMode: "per_action",
      summary: null,
      proposalOrder: ["a1", "a2"],
    };
    const decisions = [makeTrace("a1", "allow"), makeTrace("a2", "allow")];
    const result = evaluatePlan(plan, decisions);
    expect(result.planDecision).toBe("allow");
  });

  it("best effort: partial execution", () => {
    const plan: ActionPlan = {
      id: "plan-2",
      envelopeId: "env-1",
      strategy: "best_effort",
      approvalMode: "per_action",
      summary: null,
      proposalOrder: ["a1", "a2"],
    };
    const decisions = [makeTrace("a1", "allow"), makeTrace("a2", "deny")];
    const result = evaluatePlan(plan, decisions);
    expect(result.planDecision).toBe("partial");
    expect(result.perProposal.get("a1")).toBe("allow");
    expect(result.perProposal.get("a2")).toBe("deny");
  });

  it("sequential: stop on first failure", () => {
    const plan: ActionPlan = {
      id: "plan-3",
      envelopeId: "env-1",
      strategy: "sequential",
      approvalMode: "per_action",
      summary: null,
      proposalOrder: ["a1", "a2", "a3"],
    };
    const decisions = [
      makeTrace("a1", "allow"),
      makeTrace("a2", "deny"),
      makeTrace("a3", "allow"),
    ];
    const result = evaluatePlan(plan, decisions);
    expect(result.planDecision).toBe("partial");
    expect(result.perProposal.get("a1")).toBe("allow");
    expect(result.perProposal.get("a2")).toBe("deny");
    expect(result.perProposal.get("a3")).toBe("deny"); // denied because a2 failed first
    expect(result.explanation).toContain("stopped at first failure");
  });
});

// ===================================================================
// RESOLVER
// ===================================================================

describe("Resolver", () => {
  it("resolved entity", async () => {
    const resolver: EntityResolver = {
      resolve: async (_ref, _type, _ctx) => ({
        id: "entity-1",
        inputRef: "Campaign Alpha",
        resolvedType: "campaign",
        resolvedId: "camp-123",
        resolvedName: "Campaign Alpha",
        confidence: 1.0,
        alternatives: [],
        status: "resolved" as const,
      }),
    };

    const result = await resolveEntities(
      [{ inputRef: "Campaign Alpha", entityType: "campaign" }],
      resolver,
      {},
    );
    expect(result.resolved).toHaveLength(1);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.notFound).toHaveLength(0);
  });

  it("ambiguous entity -> clarification question", async () => {
    const ambiguousEntity: ResolvedEntity = {
      id: "entity-2",
      inputRef: "Alpha",
      resolvedType: "campaign",
      resolvedId: "",
      resolvedName: "",
      confidence: 0.5,
      alternatives: [
        { id: "camp-1", name: "Campaign Alpha", score: 0.8 },
        { id: "camp-2", name: "Campaign Alpha Beta", score: 0.6 },
      ],
      status: "ambiguous" as const,
    };

    const resolver: EntityResolver = {
      resolve: async () => ambiguousEntity,
    };

    const result = await resolveEntities(
      [{ inputRef: "Alpha", entityType: "campaign" }],
      resolver,
      {},
    );
    expect(result.ambiguous).toHaveLength(1);

    const question = buildClarificationQuestion(result.ambiguous);
    expect(question).toContain("Alpha");
    expect(question).toContain("Campaign Alpha");
    expect(question).toContain("camp-1");
  });

  it("not found entity -> explanation", async () => {
    const notFoundEntity: ResolvedEntity = {
      id: "entity-3",
      inputRef: "Nonexistent Campaign",
      resolvedType: "campaign",
      resolvedId: "",
      resolvedName: "",
      confidence: 0,
      alternatives: [],
      status: "not_found" as const,
    };

    const resolver: EntityResolver = {
      resolve: async () => notFoundEntity,
    };

    const result = await resolveEntities(
      [{ inputRef: "Nonexistent Campaign", entityType: "campaign" }],
      resolver,
      {},
    );
    expect(result.notFound).toHaveLength(1);

    const explanation = buildNotFoundExplanation(result.notFound);
    expect(explanation).toContain("Nonexistent Campaign");
    expect(explanation).toContain("Could not find");
  });

  it("buildClarificationQuestion returns empty string for no ambiguous entities", () => {
    expect(buildClarificationQuestion([])).toBe("");
  });

  it("buildNotFoundExplanation returns empty string for no missing entities", () => {
    expect(buildNotFoundExplanation([])).toBe("");
  });
});

// ===================================================================
// POLICY ENGINE
// ===================================================================

describe("Policy Engine", () => {
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
    guardrailState.lastActionTimes.set("entity:entity-1", Date.now() - 60_000); // 1 min ago, cooldown is 5 min

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
    const proposal = makeProposal({ parameters: { amount: 5000 } }); // exceeds perAction=1000
    const engineCtx = makeEngineContext({ resolvedIdentity: identity });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "SPEND_LIMIT" && c.matched)).toBe(true);
  });

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
    expect(trace.finalDecision).toBe("allow");
    // All spend checks should be unmatched
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
    // No spendLookup — should not check daily/weekly/monthly
    const engineCtx = makeEngineContext({ resolvedIdentity: identity });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("allow");
    // Should have perAction check only, no daily/weekly/monthly
    const dailyCheck = trace.checks.find(
      (c) => c.checkCode === "SPEND_LIMIT" && c.checkData["field"] === "daily",
    );
    expect(dailyCheck).toBeUndefined();
  });

  it("policy rule match -> apply deny effect", () => {
    const denyPolicy = makePolicy({
      id: "deny-policy",
      name: "Block large budgets",
      priority: 1,
      effect: "deny",
      rule: {
        composition: "AND",
        conditions: [
          { field: "actionType", operator: "eq", value: "campaign.update_budget" },
        ],
      },
    });

    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext({ policies: [denyPolicy] });

    const trace = evaluate(proposal, ctx, engineCtx);
    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some(
      (c) => c.checkCode === "POLICY_RULE" && c.matched && c.effect === "deny",
    )).toBe(true);
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
    // The risk score should map to a category and then look up approval requirement
    expect(trace.finalDecision).toBe("allow");
    expect(["standard", "elevated", "mandatory"]).toContain(trace.approvalRequired);
  });
});

// ===================================================================
// AUDIT LEDGER (integration-level)
// ===================================================================

describe("AuditLedger", () => {
  it("records entries and maintains hash chain", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    const entry1 = await ledger.record({
      eventType: "action.evaluated",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      summary: "First entry",
      snapshot: { budget: 100 },
    });

    const entry2 = await ledger.record({
      eventType: "action.executed",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      summary: "Second entry",
      snapshot: { budget: 200 },
    });

    expect(entry1.previousEntryHash).toBeNull();
    expect(entry2.previousEntryHash).toBe(entry1.entryHash);

    const chainResult = await ledger.verifyChain([entry1, entry2]);
    expect(chainResult.valid).toBe(true);
  });

  it("applies redaction by default when no config is passed", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage); // no second arg

    const entry = await ledger.record({
      eventType: "action.evaluated",
      actorType: "user",
      actorId: "user-1",
      entityType: "account",
      entityId: "acct-1",
      riskCategory: "medium",
      summary: "Default redaction test",
      snapshot: {
        email: "pii@example.com",
        password: "supersecret",
        normalField: "visible",
      },
    });

    expect(entry.snapshot["email"]).toBe("[REDACTED]");
    expect(entry.snapshot["password"]).toBe("[REDACTED]");
    expect(entry.snapshot["normalField"]).toBe("visible");
    expect(entry.redactionApplied).toBe(true);
  });

  it("applies redaction when configured", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage, DEFAULT_REDACTION_CONFIG);

    const entry = await ledger.record({
      eventType: "action.evaluated",
      actorType: "user",
      actorId: "user-1",
      entityType: "account",
      entityId: "acct-1",
      riskCategory: "medium",
      summary: "Evaluated with PII",
      snapshot: {
        email: "user@example.com",
        password: "secret123",
        normalField: "hello",
      },
    });

    expect(entry.snapshot["email"]).toBe("[REDACTED]");
    expect(entry.snapshot["password"]).toBe("[REDACTED]");
    expect(entry.snapshot["normalField"]).toBe("hello");
    expect(entry.redactionApplied).toBe(true);
  });

  it("queries entries by filter", async () => {
    const storage = new InMemoryLedgerStorage();
    const ledger = new AuditLedger(storage);

    await ledger.record({
      eventType: "action.evaluated",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-1",
      riskCategory: "low",
      summary: "Entry 1",
      snapshot: {},
      envelopeId: "env-1",
    });

    await ledger.record({
      eventType: "action.executed",
      actorType: "agent",
      actorId: "agent-1",
      entityType: "campaign",
      entityId: "camp-2",
      riskCategory: "medium",
      summary: "Entry 2",
      snapshot: {},
      envelopeId: "env-2",
    });

    const filtered = await ledger.query({ entityId: "camp-1" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.entityId).toBe("camp-1");

    const byType = await ledger.query({ eventType: "action.executed" });
    expect(byType).toHaveLength(1);
    expect(byType[0]?.summary).toBe("Entry 2");
  });
});

// ===================================================================
// SHA256 utility
// ===================================================================

describe("sha256 utility", () => {
  it("produces consistent hex output", () => {
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("different inputs produce different hashes", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

// ===================================================================
// hashObject utility
// ===================================================================

describe("hashObject", () => {
  it("hashes objects deterministically", () => {
    const obj = { a: 1, b: "two" };
    expect(hashObject(obj)).toBe(hashObject(obj));
    expect(hashObject(obj)).toHaveLength(64);
  });
});

// ===================================================================
// createGuardrailState
// ===================================================================

describe("createGuardrailState", () => {
  it("creates empty guardrail state", () => {
    const state = createGuardrailState();
    expect(state.actionCounts.size).toBe(0);
    expect(state.lastActionTimes.size).toBe(0);
  });
});

// ===================================================================
// POLICY ENGINE — COMPOSITE RISK
// ===================================================================

describe("Policy Engine — Composite Risk", () => {
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
    const compositeCheck = trace.checks.find(
      (c) => c.checkCode === "COMPOSITE_RISK",
    );
    expect(compositeCheck).toBeDefined();
  });

  it("no COMPOSITE_RISK check when compositeContext is absent", () => {
    const ctx = makeEvalContext();
    const proposal = makeProposal();
    const engineCtx = makeEngineContext();

    const trace = evaluate(proposal, ctx, engineCtx);
    const compositeCheck = trace.checks.find(
      (c) => c.checkCode === "COMPOSITE_RISK",
    );
    expect(compositeCheck).toBeUndefined();
  });

  it("composite risk bumps category → changes approval requirement", () => {
    // Start with low risk identity that requires "standard" for medium
    const identity = makeResolvedIdentity({
      effectiveRiskTolerance: {
        none: "none",
        low: "none",
        medium: "standard",
        high: "elevated",
        critical: "mandatory",
      },
    });

    // Base score will be in the "low" range (~35)
    const riskInput = makeRiskInput({
      baseRisk: "medium",
    });

    // Large composite penalties to push from low to medium
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

    // The composite risk check should be matched (category changed)
    const compositeCheck = trace.checks.find(
      (c) => c.checkCode === "COMPOSITE_RISK",
    );
    expect(compositeCheck).toBeDefined();
    expect(compositeCheck!.matched).toBe(true);

    // Score should have increased
    expect(trace.computedRiskScore.rawScore).toBeGreaterThan(35);
  });
});
