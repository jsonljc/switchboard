import type {
  DecisionTrace,
  DecisionCheck,
  CheckCode,
  CheckEffect,
  RiskScore,
  ApprovalRequirement,
  FinalDecision,
} from "@switchboard/schemas";

export interface DecisionTraceBuilder {
  envelopeId: string;
  actionId: string;
  checks: DecisionCheck[];
  computedRiskScore: RiskScore | null;
  finalDecision: FinalDecision | null;
  approvalRequired: ApprovalRequirement | null;
}

export function createTraceBuilder(
  envelopeId: string,
  actionId: string,
): DecisionTraceBuilder {
  return {
    envelopeId,
    actionId,
    checks: [],
    computedRiskScore: null,
    finalDecision: null,
    approvalRequired: null,
  };
}

export function addCheck(
  builder: DecisionTraceBuilder,
  checkCode: CheckCode,
  checkData: Record<string, unknown>,
  humanDetail: string,
  matched: boolean,
  effect: CheckEffect,
): void {
  builder.checks.push({
    checkCode,
    checkData,
    humanDetail,
    matched,
    effect,
  });
}

export function buildTrace(builder: DecisionTraceBuilder): DecisionTrace {
  if (!builder.computedRiskScore) {
    throw new Error("Cannot build trace without computed risk score");
  }

  const denied = builder.checks.some((c) => c.matched && c.effect === "deny");
  const modified = builder.checks.some((c) => c.matched && c.effect === "modify");

  const finalDecision: FinalDecision =
    builder.finalDecision ?? (denied ? "deny" : modified ? "modify" : "allow");

  const approvalRequired: ApprovalRequirement =
    builder.approvalRequired ?? "none";

  // Build explanation from matched checks
  const matchedChecks = builder.checks.filter((c) => c.matched);
  let explanation: string;
  if (finalDecision === "deny") {
    const denyCheck = matchedChecks.find((c) => c.effect === "deny");
    explanation = denyCheck
      ? `Denied: ${denyCheck.humanDetail}`
      : "Action denied by policy.";
  } else if (finalDecision === "modify") {
    explanation = "Action allowed with modifications.";
  } else if (approvalRequired !== "none") {
    explanation = `Action allowed pending ${approvalRequired} approval.`;
  } else {
    explanation = "Action allowed.";
  }

  return {
    actionId: builder.actionId,
    envelopeId: builder.envelopeId,
    checks: builder.checks,
    computedRiskScore: builder.computedRiskScore,
    finalDecision,
    approvalRequired,
    explanation,
    evaluatedAt: new Date(),
  };
}
