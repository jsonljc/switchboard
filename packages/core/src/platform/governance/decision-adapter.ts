import type { DecisionTrace } from "@switchboard/schemas";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";

export function toGovernanceDecision(
  trace: DecisionTrace,
  constraints: ExecutionConstraints,
): GovernanceDecision {
  const matchedPolicies = trace.checks.filter((c) => c.matched).map((c) => c.checkCode);

  const riskScore = trace.computedRiskScore.rawScore;

  if (trace.finalDecision === "deny") {
    const denyCheck = trace.checks.find((c) => c.matched && c.effect === "deny");
    return {
      outcome: "deny",
      reasonCode: denyCheck?.checkCode ?? "POLICY_RULE",
      riskScore,
      matchedPolicies,
    };
  }

  if (trace.approvalRequired !== "none") {
    return {
      outcome: "require_approval",
      riskScore,
      approvalLevel: trace.approvalRequired,
      approvers: [],
      constraints,
      matchedPolicies,
    };
  }

  return {
    outcome: "execute",
    riskScore,
    budgetProfile: riskScore <= 20 ? "cheap" : riskScore <= 60 ? "standard" : "expensive",
    constraints,
    matchedPolicies,
  };
}
