import type {
  ActionPlan,
  DecisionTrace,
  FinalDecision,
} from "@switchboard/schemas";

export interface PlanEvaluationResult {
  planDecision: "allow" | "deny" | "partial";
  perProposal: Map<string, FinalDecision>;
  explanation: string;
}

export function evaluatePlan(
  plan: ActionPlan,
  decisions: DecisionTrace[],
): PlanEvaluationResult {
  const perProposal = new Map<string, FinalDecision>();
  for (const d of decisions) {
    perProposal.set(d.actionId, d.finalDecision);
  }

  switch (plan.strategy) {
    case "atomic":
      return evaluateAtomic(plan, perProposal);
    case "best_effort":
      return evaluateBestEffort(plan, perProposal);
    case "sequential":
      return evaluateSequential(plan, perProposal);
  }
}

function evaluateAtomic(
  _plan: ActionPlan,
  perProposal: Map<string, FinalDecision>,
): PlanEvaluationResult {
  const anyDenied = Array.from(perProposal.values()).some((d) => d === "deny");

  if (anyDenied) {
    // In atomic mode, if any is denied, all are denied
    const allDenied = new Map<string, FinalDecision>();
    for (const [id] of perProposal) {
      allDenied.set(id, "deny");
    }
    return {
      planDecision: "deny",
      perProposal: allDenied,
      explanation:
        "Atomic plan: one or more actions were denied, so the entire plan is denied.",
    };
  }

  return {
    planDecision: "allow",
    perProposal,
    explanation: "Atomic plan: all actions allowed.",
  };
}

function evaluateBestEffort(
  _plan: ActionPlan,
  perProposal: Map<string, FinalDecision>,
): PlanEvaluationResult {
  const anyDenied = Array.from(perProposal.values()).some((d) => d === "deny");
  const anyAllowed = Array.from(perProposal.values()).some(
    (d) => d === "allow" || d === "modify",
  );

  let planDecision: "allow" | "deny" | "partial";
  if (!anyAllowed) {
    planDecision = "deny";
  } else if (anyDenied) {
    planDecision = "partial";
  } else {
    planDecision = "allow";
  }

  return {
    planDecision,
    perProposal,
    explanation: `Best-effort plan: each action evaluated independently.`,
  };
}

function evaluateSequential(
  plan: ActionPlan,
  perProposal: Map<string, FinalDecision>,
): PlanEvaluationResult {
  const updatedProposals = new Map<string, FinalDecision>(perProposal);
  let hitFailure = false;

  for (const proposalId of plan.proposalOrder) {
    if (hitFailure) {
      updatedProposals.set(proposalId, "deny");
      continue;
    }
    const decision = perProposal.get(proposalId);
    if (decision === "deny") {
      hitFailure = true;
    }
  }

  const anyDenied = Array.from(updatedProposals.values()).some(
    (d) => d === "deny",
  );
  const anyAllowed = Array.from(updatedProposals.values()).some(
    (d) => d === "allow" || d === "modify",
  );

  let planDecision: "allow" | "deny" | "partial";
  if (!anyAllowed) {
    planDecision = "deny";
  } else if (anyDenied) {
    planDecision = "partial";
  } else {
    planDecision = "allow";
  }

  return {
    planDecision,
    perProposal: updatedProposals,
    explanation: `Sequential plan: ${hitFailure ? "stopped at first failure" : "all actions passed"}.`,
  };
}
