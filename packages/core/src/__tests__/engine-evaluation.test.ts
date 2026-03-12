import { describe, it, expect } from "vitest";

import {
  evaluateRule,
  createTraceBuilder,
  addCheck,
  buildTrace,
  resolveEntities,
  buildClarificationQuestion,
  buildNotFoundExplanation,
  evaluatePlan,
} from "../index.js";

import type { EvaluationContext, EntityResolver } from "../index.js";

import type { PolicyRule, ActionPlan, DecisionTrace, ResolvedEntity } from "@switchboard/schemas";

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
      conditions: [{ field: "cartridgeId", operator: "in", value: ["google-ads", "meta-ads"] }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("not_in: matches when field is not in the expected array", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "cartridgeId", operator: "not_in", value: ["meta-ads", "tiktok-ads"] }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("contains: matches when string field includes substring", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "contains", value: "update" }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);
  });

  it("matches: matches when string field matches regex", () => {
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "actionType", operator: "matches", value: "^campaign\\." }],
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
      conditions: [{ field: "actionType", operator: "eq", value: "account.delete" }],
    };
    expect(evaluateRule(rule, ctx).matched).toBe(true);

    const ruleMatching: PolicyRule = {
      composition: "NOT",
      conditions: [{ field: "actionType", operator: "eq", value: "campaign.update_budget" }],
    };
    expect(evaluateRule(ruleMatching, ctx).matched).toBe(false);
  });

  it("nested path evaluation: resolves dot-separated paths", () => {
    const ruleCtx = makeEvalContext({ parameters: { amount: 750 } });
    const rule: PolicyRule = {
      composition: "AND",
      conditions: [{ field: "parameters.amount", operator: "gte", value: 500 }],
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
      conditions: [{ field: "actionType", operator: "eq", value: "campaign.update_budget" }],
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
    const decisions = [makeTrace("a1", "allow"), makeTrace("a2", "deny"), makeTrace("a3", "allow")];

    const result = evaluatePlan(plan, decisions);
    expect(result.planDecision).toBe("deny");
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
    const decisions = [makeTrace("a1", "allow"), makeTrace("a2", "deny"), makeTrace("a3", "allow")];
    const result = evaluatePlan(plan, decisions);
    expect(result.planDecision).toBe("partial");
    expect(result.perProposal.get("a1")).toBe("allow");
    expect(result.perProposal.get("a2")).toBe("deny");
    expect(result.perProposal.get("a3")).toBe("deny");
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
