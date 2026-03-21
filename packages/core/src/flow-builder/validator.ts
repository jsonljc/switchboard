// ---------------------------------------------------------------------------
// Flow Validator — validates flow definitions for structural correctness
// ---------------------------------------------------------------------------

import type { FlowDefinition, FlowStep } from "@switchboard/schemas";

export interface ValidationIssue {
  severity: "error" | "warning";
  stepId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validateFlowDefinition(flow: FlowDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];
  const stepIds = new Set(flow.steps.map((s) => s.id));

  // Check for duplicate step IDs
  const seen = new Set<string>();
  for (const step of flow.steps) {
    if (seen.has(step.id)) {
      issues.push({ severity: "error", stepId: step.id, message: "Duplicate step ID" });
    }
    seen.add(step.id);
  }

  for (const step of flow.steps) {
    // Check nextStepId references
    if (step.nextStepId && !stepIds.has(step.nextStepId)) {
      issues.push({
        severity: "error",
        stepId: step.id,
        message: `nextStepId "${step.nextStepId}" does not reference an existing step`,
      });
    }

    // Check branch target references
    if (step.branches) {
      for (const branch of step.branches) {
        if (!stepIds.has(branch.targetStepId)) {
          issues.push({
            severity: "error",
            stepId: step.id,
            message: `Branch target "${branch.targetStepId}" does not reference an existing step`,
          });
        }
      }
    }

    // Validate step-type-specific requirements
    validateStepRequirements(step, issues);
  }

  // Check for infinite loops (simple cycle detection via DFS)
  detectCycles(flow.steps, stepIds, issues);

  return {
    valid: issues.every((i) => i.severity !== "error"),
    issues,
  };
}

function validateStepRequirements(step: FlowStep, issues: ValidationIssue[]): void {
  switch (step.type) {
    case "question":
      if (!step.template) {
        issues.push({
          severity: "error",
          stepId: step.id,
          message: "Question step must have a template",
        });
      }
      break;
    case "message":
      if (!step.template) {
        issues.push({
          severity: "error",
          stepId: step.id,
          message: "Message step must have a template",
        });
      }
      break;
    case "branch":
      if (!step.branches || step.branches.length === 0) {
        issues.push({
          severity: "error",
          stepId: step.id,
          message: "Branch step must have at least one branch condition",
        });
      }
      break;
    case "action":
      if (!step.actionType) {
        issues.push({
          severity: "error",
          stepId: step.id,
          message: "Action step must specify an actionType",
        });
      }
      break;
    case "wait":
      if (step.waitMs == null || step.waitMs <= 0) {
        issues.push({
          severity: "warning",
          stepId: step.id,
          message: "Wait step should have a positive waitMs",
        });
      }
      break;
  }
}

function detectCycles(steps: FlowStep[], stepIds: Set<string>, issues: ValidationIssue[]): void {
  const stepMap = new Map(steps.map((s, i) => [s.id, { step: s, index: i }]));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(stepId: string): void {
    if (inStack.has(stepId)) {
      issues.push({
        severity: "warning",
        stepId,
        message: "Potential cycle detected involving this step",
      });
      return;
    }
    if (visited.has(stepId)) return;

    visited.add(stepId);
    inStack.add(stepId);

    const entry = stepMap.get(stepId);
    if (!entry) return;

    const { step, index } = entry;

    // Follow nextStepId
    if (step.nextStepId && stepIds.has(step.nextStepId)) {
      dfs(step.nextStepId);
    } else if (!step.nextStepId) {
      // Sequential: next step is index + 1
      const nextStep = steps[index + 1];
      if (nextStep) {
        dfs(nextStep.id);
      }
    }

    // Follow branch targets
    if (step.branches) {
      for (const branch of step.branches) {
        if (stepIds.has(branch.targetStepId)) {
          dfs(branch.targetStepId);
        }
      }
    }

    inStack.delete(stepId);
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id);
    }
  }
}
