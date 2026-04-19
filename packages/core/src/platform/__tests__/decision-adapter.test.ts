import { describe, it, expect } from "vitest";
import type { DecisionTrace } from "@switchboard/schemas";
import { toGovernanceDecision } from "../governance/decision-adapter.js";
import type { ExecutionConstraints } from "../governance-types.js";

function makeConstraints(overrides?: Partial<ExecutionConstraints>): ExecutionConstraints {
  return {
    allowedModelTiers: ["default", "premium"],
    maxToolCalls: 20,
    maxLlmTurns: 6,
    maxTotalTokens: 64_000,
    maxRuntimeMs: 30_000,
    maxWritesPerExecution: 5,
    trustLevel: "guided",
    ...overrides,
  };
}

function makeTrace(overrides?: Partial<DecisionTrace>): DecisionTrace {
  return {
    actionId: "act-1",
    envelopeId: "env-1",
    checks: [],
    computedRiskScore: {
      rawScore: 25,
      category: "low",
      factors: [],
    },
    finalDecision: "allow",
    approvalRequired: "none",
    explanation: "All checks passed",
    evaluatedAt: new Date("2026-04-16T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toGovernanceDecision", () => {
  it("returns execute when allowed with no approval", () => {
    const trace = makeTrace({
      finalDecision: "allow",
      approvalRequired: "none",
      checks: [
        {
          checkCode: "RISK_SCORING",
          checkData: { rawScore: 25 },
          humanDetail: "Risk score: 25 (low).",
          matched: true,
          effect: "skip",
        },
      ],
    });
    const result = toGovernanceDecision(trace, makeConstraints());
    expect(result.outcome).toBe("execute");
    if (result.outcome === "execute") {
      expect(result.constraints).toBeDefined();
      expect(result.matchedPolicies).toEqual(["RISK_SCORING"]);
    }
  });

  it("returns require_approval when approval is needed", () => {
    const trace = makeTrace({
      finalDecision: "allow",
      approvalRequired: "elevated",
      checks: [
        {
          checkCode: "RISK_SCORING",
          checkData: {},
          humanDetail: "Risk score: 60 (high).",
          matched: true,
          effect: "skip",
        },
      ],
    });
    const result = toGovernanceDecision(trace, makeConstraints());
    expect(result.outcome).toBe("require_approval");
    if (result.outcome === "require_approval") {
      expect(result.approvalLevel).toBe("elevated");
    }
  });

  it("returns deny with reasonCode from first deny check", () => {
    const trace = makeTrace({
      finalDecision: "deny",
      checks: [
        {
          checkCode: "TRUST_BEHAVIOR",
          checkData: {},
          humanDetail: "Not trusted",
          matched: false,
          effect: "skip",
        },
        {
          checkCode: "FORBIDDEN_BEHAVIOR",
          checkData: {},
          humanDetail: "Action is forbidden",
          matched: true,
          effect: "deny",
        },
      ],
    });
    const result = toGovernanceDecision(trace, makeConstraints());
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") {
      expect(result.reasonCode).toBe("FORBIDDEN_BEHAVIOR");
    }
  });

  it("extracts matchedPolicies from checks where matched is true", () => {
    const trace = makeTrace({
      finalDecision: "allow",
      approvalRequired: "none",
      checks: [
        {
          checkCode: "RISK_SCORING",
          checkData: {},
          humanDetail: "Risk OK",
          matched: true,
          effect: "skip",
        },
        {
          checkCode: "POLICY_RULE",
          checkData: {},
          humanDetail: "Policy did not match",
          matched: false,
          effect: "skip",
        },
        {
          checkCode: "CONFIDENCE",
          checkData: {},
          humanDetail: "Confidence OK",
          matched: true,
          effect: "skip",
        },
      ],
    });
    const result = toGovernanceDecision(trace, makeConstraints());
    expect(result.matchedPolicies).toEqual(["RISK_SCORING", "CONFIDENCE"]);
  });

  it("falls back to POLICY_RULE reasonCode when no deny check found", () => {
    const trace = makeTrace({
      finalDecision: "deny",
      checks: [
        {
          checkCode: "RISK_SCORING",
          checkData: {},
          humanDetail: "Risk OK",
          matched: false,
          effect: "skip",
        },
      ],
    });
    const result = toGovernanceDecision(trace, makeConstraints());
    expect(result.outcome).toBe("deny");
    if (result.outcome === "deny") {
      expect(result.reasonCode).toBe("POLICY_RULE");
    }
  });
});
