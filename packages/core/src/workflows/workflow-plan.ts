import type {
  WorkflowPlan,
  WorkflowStep,
  WorkflowStepStatus,
  PendingAction,
} from "@switchboard/schemas";

const MAX_PLAN_STEPS = 3;

export function createWorkflowPlan(
  actions: PendingAction[],
  strategy: "sequential" | "parallel_where_possible",
): WorkflowPlan {
  if (actions.length === 0 || actions.length > MAX_PLAN_STEPS) {
    throw new Error(`WorkflowPlan must have 1-3 steps, got ${actions.length}`);
  }
  const steps: WorkflowStep[] = actions.map((action, i) => ({
    index: i,
    actionId: action.id,
    dependsOn: strategy === "sequential" && i > 0 ? [i - 1] : [],
    status: "pending" as const,
    result: null,
  }));
  return { steps, strategy, replannedCount: 0 };
}

export function advanceStep(
  plan: WorkflowPlan,
  stepIndex: number,
  status: WorkflowStepStatus,
  result: Record<string, unknown> | null,
): WorkflowPlan {
  const updatedSteps = plan.steps.map((step) =>
    step.index === stepIndex ? { ...step, status, result } : { ...step },
  );
  return { ...plan, steps: updatedSteps };
}

export function canReplan(replansUsed: number, maxReplans: number): boolean {
  return replansUsed < maxReplans;
}

export function getNextPendingStep(plan: WorkflowPlan): WorkflowStep | null {
  return (
    plan.steps.find((step) => {
      if (step.status !== "pending") return false;
      return step.dependsOn.every((depIdx) => {
        const dep = plan.steps.find((s) => s.index === depIdx);
        return dep?.status === "completed";
      });
    }) ?? null
  );
}

export function areAllStepsTerminal(plan: WorkflowPlan): boolean {
  return plan.steps.every(
    (s) => s.status === "completed" || s.status === "failed" || s.status === "skipped",
  );
}
