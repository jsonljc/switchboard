import { describe, it, expect } from "vitest";
import { createTraceBuilder, addCheck, buildTrace } from "../engine/decision-trace.js";
import type { DecisionTraceBuilder } from "../engine/decision-trace.js";
import type { CheckCode, CheckEffect, RiskScore } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRiskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    rawScore: 30,
    category: "low",
    factors: [
      { factor: "base_risk", weight: 15, contribution: 15, detail: "Base risk category: low" },
    ],
    ...overrides,
  };
}

function builderWithRiskScore(envelopeId = "env-1", actionId = "action-1"): DecisionTraceBuilder {
  const builder = createTraceBuilder(envelopeId, actionId);
  builder.computedRiskScore = makeRiskScore();
  return builder;
}

// ---------------------------------------------------------------------------
// createTraceBuilder
// ---------------------------------------------------------------------------

describe("createTraceBuilder", () => {
  it("creates a builder with given envelopeId and actionId", () => {
    const builder = createTraceBuilder("env-abc", "action-xyz");
    expect(builder.envelopeId).toBe("env-abc");
    expect(builder.actionId).toBe("action-xyz");
  });

  it("initializes checks as an empty array", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    expect(builder.checks).toEqual([]);
  });

  it("initializes computedRiskScore as null", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    expect(builder.computedRiskScore).toBeNull();
  });

  it("initializes finalDecision as null", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    expect(builder.finalDecision).toBeNull();
  });

  it("initializes approvalRequired as null", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    expect(builder.approvalRequired).toBeNull();
  });

  it("handles empty string ids", () => {
    const builder = createTraceBuilder("", "");
    expect(builder.envelopeId).toBe("");
    expect(builder.actionId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// addCheck
// ---------------------------------------------------------------------------

describe("addCheck", () => {
  it("appends a check to the builder checks array", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    addCheck(
      builder,
      "FORBIDDEN_BEHAVIOR",
      { behavior: "delete" },
      "Forbidden action",
      true,
      "deny",
    );
    expect(builder.checks).toHaveLength(1);
    expect(builder.checks[0]).toEqual({
      checkCode: "FORBIDDEN_BEHAVIOR",
      checkData: { behavior: "delete" },
      humanDetail: "Forbidden action",
      matched: true,
      effect: "deny",
    });
  });

  it("appends multiple checks in order", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "First", true, "deny");
    addCheck(builder, "TRUST_BEHAVIOR", {}, "Second", false, "allow");
    addCheck(builder, "RATE_LIMIT", { limit: 100 }, "Third", true, "modify");
    expect(builder.checks).toHaveLength(3);
    expect(builder.checks[0]!.checkCode).toBe("FORBIDDEN_BEHAVIOR");
    expect(builder.checks[1]!.checkCode).toBe("TRUST_BEHAVIOR");
    expect(builder.checks[2]!.checkCode).toBe("RATE_LIMIT");
  });

  it("handles matched=false checks", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    addCheck(builder, "POLICY_RULE", { rule: "budget_cap" }, "Policy not triggered", false, "skip");
    expect(builder.checks[0]!.matched).toBe(false);
    expect(builder.checks[0]!.effect).toBe("skip");
  });

  it("preserves arbitrary checkData", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    const complexData = {
      nested: { value: 42 },
      list: [1, 2, 3],
      flag: true,
    };
    addCheck(builder, "SPEND_LIMIT", complexData, "Complex data", true, "deny");
    expect(builder.checks[0]!.checkData).toEqual(complexData);
  });

  it("supports all CheckCode values", () => {
    const codes: CheckCode[] = [
      "FORBIDDEN_BEHAVIOR",
      "TRUST_BEHAVIOR",
      "RATE_LIMIT",
      "COOLDOWN",
      "PROTECTED_ENTITY",
      "SPEND_LIMIT",
      "POLICY_RULE",
      "RISK_SCORING",
      "RESOLVER_AMBIGUITY",
      "COMPETENCE_TRUST",
      "COMPETENCE_ESCALATION",
      "COMPOSITE_RISK",
      "DELEGATION_CHAIN",
      "SYSTEM_POSTURE",
    ];
    const builder = createTraceBuilder("env-1", "act-1");
    for (const code of codes) {
      addCheck(builder, code, {}, `Check ${code}`, false, "allow");
    }
    expect(builder.checks).toHaveLength(codes.length);
  });

  it("supports all CheckEffect values", () => {
    const effects: CheckEffect[] = ["allow", "deny", "modify", "skip", "escalate"];
    const builder = createTraceBuilder("env-1", "act-1");
    for (const effect of effects) {
      addCheck(builder, "POLICY_RULE", {}, `Effect ${effect}`, true, effect);
    }
    expect(builder.checks).toHaveLength(effects.length);
    expect(builder.checks.map((c) => c.effect)).toEqual(effects);
  });

  it("handles empty checkData", () => {
    const builder = createTraceBuilder("env-1", "act-1");
    addCheck(builder, "TRUST_BEHAVIOR", {}, "Empty data", true, "allow");
    expect(builder.checks[0]!.checkData).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// buildTrace
// ---------------------------------------------------------------------------

describe("buildTrace", () => {
  describe("error handling", () => {
    it("throws if computedRiskScore is not set", () => {
      const builder = createTraceBuilder("env-1", "act-1");
      expect(() => buildTrace(builder)).toThrow("Cannot build trace without computed risk score");
    });
  });

  describe("finalDecision inference", () => {
    it("infers 'deny' when a matched check has deny effect", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Forbidden", true, "deny");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("deny");
    });

    it("infers 'modify' when a matched check has modify effect and no deny", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "RATE_LIMIT", {}, "Rate limited", true, "modify");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("modify");
    });

    it("infers 'allow' when no matched checks have deny or modify effects", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "TRUST_BEHAVIOR", {}, "Trusted", true, "allow");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
    });

    it("infers 'allow' when there are no checks at all", () => {
      const builder = builderWithRiskScore();
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
    });

    it("deny takes priority over modify when both are matched", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "RATE_LIMIT", {}, "Modified", true, "modify");
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Denied", true, "deny");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("deny");
    });

    it("unmatched deny does not trigger deny decision", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Not matched", false, "deny");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
    });

    it("unmatched modify does not trigger modify decision", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "RATE_LIMIT", {}, "Not matched", false, "modify");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
    });

    it("matched 'skip' and 'escalate' effects do not count as deny or modify", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "RISK_SCORING", {}, "Skipped", true, "skip");
      addCheck(builder, "COMPETENCE_ESCALATION", {}, "Escalated", true, "escalate");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
    });
  });

  describe("finalDecision override", () => {
    it("uses builder.finalDecision when explicitly set", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Denied check", true, "deny");
      builder.finalDecision = "allow"; // Override
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
    });

    it("respects explicit 'modify' override", () => {
      const builder = builderWithRiskScore();
      builder.finalDecision = "modify";
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("modify");
    });

    it("respects explicit 'deny' override even with no deny checks", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "TRUST_BEHAVIOR", {}, "Trusted", true, "allow");
      builder.finalDecision = "deny";
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("deny");
    });
  });

  describe("approvalRequired", () => {
    it("defaults to 'none' when not set", () => {
      const builder = builderWithRiskScore();
      const trace = buildTrace(builder);
      expect(trace.approvalRequired).toBe("none");
    });

    it("uses builder.approvalRequired when set", () => {
      const builder = builderWithRiskScore();
      builder.approvalRequired = "elevated";
      const trace = buildTrace(builder);
      expect(trace.approvalRequired).toBe("elevated");
    });

    it("supports 'standard' approval requirement", () => {
      const builder = builderWithRiskScore();
      builder.approvalRequired = "standard";
      const trace = buildTrace(builder);
      expect(trace.approvalRequired).toBe("standard");
    });

    it("supports 'mandatory' approval requirement", () => {
      const builder = builderWithRiskScore();
      builder.approvalRequired = "mandatory";
      const trace = buildTrace(builder);
      expect(trace.approvalRequired).toBe("mandatory");
    });
  });

  describe("explanation generation", () => {
    it("deny explanation includes the deny check detail", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Campaign deletion is forbidden", true, "deny");
      const trace = buildTrace(builder);
      expect(trace.explanation).toBe("Denied: Campaign deletion is forbidden");
    });

    it("deny with no matching deny check uses fallback message", () => {
      const builder = builderWithRiskScore();
      builder.finalDecision = "deny";
      const trace = buildTrace(builder);
      expect(trace.explanation).toBe("Action denied by policy.");
    });

    it("modify explanation states modifications applied", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "RATE_LIMIT", {}, "Rate limited", true, "modify");
      const trace = buildTrace(builder);
      expect(trace.explanation).toBe("Action allowed with modifications.");
    });

    it("allow with approval required mentions approval type", () => {
      const builder = builderWithRiskScore();
      builder.approvalRequired = "elevated";
      const trace = buildTrace(builder);
      expect(trace.explanation).toContain("elevated");
      expect(trace.explanation).toContain("approval");
    });

    it("allow with no approval simply says action allowed", () => {
      const builder = builderWithRiskScore();
      const trace = buildTrace(builder);
      expect(trace.explanation).toBe("Action allowed.");
    });

    it("deny explanation picks first deny check when multiple exist", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "First deny reason", true, "deny");
      addCheck(builder, "SPEND_LIMIT", {}, "Second deny reason", true, "deny");
      const trace = buildTrace(builder);
      expect(trace.explanation).toBe("Denied: First deny reason");
    });
  });

  describe("trace structure", () => {
    it("includes envelopeId and actionId from builder", () => {
      const builder = builderWithRiskScore("envelope-42", "action-99");
      const trace = buildTrace(builder);
      expect(trace.envelopeId).toBe("envelope-42");
      expect(trace.actionId).toBe("action-99");
    });

    it("includes all checks from builder", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Check 1", true, "deny");
      addCheck(builder, "TRUST_BEHAVIOR", {}, "Check 2", false, "allow");
      addCheck(builder, "RATE_LIMIT", {}, "Check 3", true, "modify");
      const trace = buildTrace(builder);
      expect(trace.checks).toHaveLength(3);
    });

    it("includes computedRiskScore from builder", () => {
      const riskScore = makeRiskScore({ rawScore: 75, category: "high" });
      const builder = createTraceBuilder("env-1", "act-1");
      builder.computedRiskScore = riskScore;
      const trace = buildTrace(builder);
      expect(trace.computedRiskScore).toEqual(riskScore);
    });

    it("includes evaluatedAt as a Date", () => {
      const before = new Date();
      const builder = builderWithRiskScore();
      const trace = buildTrace(builder);
      const after = new Date();
      expect(trace.evaluatedAt).toBeInstanceOf(Date);
      expect(trace.evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(trace.evaluatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("complex scenarios", () => {
    it("many checks with mixed matched/unmatched produce correct decision", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "TRUST_BEHAVIOR", {}, "Trusted", true, "allow");
      addCheck(builder, "POLICY_RULE", {}, "Not triggered", false, "deny");
      addCheck(builder, "RATE_LIMIT", {}, "Not triggered", false, "modify");
      addCheck(builder, "RISK_SCORING", {}, "Scored", true, "skip");
      addCheck(builder, "COOLDOWN", {}, "Not in cooldown", false, "deny");
      const trace = buildTrace(builder);
      // No matched deny or modify, so allow
      expect(trace.finalDecision).toBe("allow");
    });

    it("single matched modify among many unmatched denies results in modify", () => {
      const builder = builderWithRiskScore();
      addCheck(builder, "FORBIDDEN_BEHAVIOR", {}, "Not matched", false, "deny");
      addCheck(builder, "SPEND_LIMIT", {}, "Not matched", false, "deny");
      addCheck(builder, "RATE_LIMIT", {}, "Matched modify", true, "modify");
      addCheck(builder, "PROTECTED_ENTITY", {}, "Not matched", false, "deny");
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("modify");
    });

    it("override finalDecision with approval requirement", () => {
      const builder = builderWithRiskScore();
      builder.finalDecision = "allow";
      builder.approvalRequired = "mandatory";
      const trace = buildTrace(builder);
      expect(trace.finalDecision).toBe("allow");
      expect(trace.approvalRequired).toBe("mandatory");
      expect(trace.explanation).toContain("mandatory");
    });
  });
});
