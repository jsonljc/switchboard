// ---------------------------------------------------------------------------
// Cadence Engine — Deterministic step evaluation
// ---------------------------------------------------------------------------

import type {
  CadenceDefinition,
  CadenceInstance,
  CadenceStep,
  CadenceCondition,
} from "./types.js";

export interface CadenceEvaluation {
  shouldExecute: boolean;
  step: CadenceStep | null;
  actionType: string | null;
  parameters: Record<string, unknown>;
  nextStepIndex: number;
  nextExecutionAt: Date | null;
  completed: boolean;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Evaluate the next step in a cadence instance.
 * Pure function — no side effects, no LLM calls.
 */
export function evaluateCadenceStep(
  definition: CadenceDefinition,
  instance: CadenceInstance,
  now: Date = new Date(),
): CadenceEvaluation {
  if (instance.status !== "active") {
    return {
      shouldExecute: false,
      step: null,
      actionType: null,
      parameters: {},
      nextStepIndex: instance.currentStepIndex,
      nextExecutionAt: null,
      completed: false,
      skipped: false,
    };
  }

  // Check if we've completed all steps
  if (instance.currentStepIndex >= definition.steps.length) {
    return {
      shouldExecute: false,
      step: null,
      actionType: null,
      parameters: {},
      nextStepIndex: instance.currentStepIndex,
      nextExecutionAt: null,
      completed: true,
      skipped: false,
    };
  }

  const step = definition.steps[instance.currentStepIndex]!;

  // Check if it's time to execute
  if (instance.nextExecutionAt && now < instance.nextExecutionAt) {
    return {
      shouldExecute: false,
      step,
      actionType: step.actionType,
      parameters: {},
      nextStepIndex: instance.currentStepIndex,
      nextExecutionAt: instance.nextExecutionAt,
      completed: false,
      skipped: false,
    };
  }

  // Evaluate condition
  if (step.condition && !evaluateCondition(step.condition, instance.variables)) {
    const nextIndex = instance.currentStepIndex + 1;
    const nextStep = definition.steps[nextIndex];
    const nextExecAt = nextStep
      ? new Date(now.getTime() + nextStep.delayMs)
      : null;

    return {
      shouldExecute: false,
      step,
      actionType: step.actionType,
      parameters: {},
      nextStepIndex: nextIndex,
      nextExecutionAt: nextExecAt,
      completed: nextIndex >= definition.steps.length,
      skipped: true,
      skipReason: `Condition not met: ${step.condition.variable} ${step.condition.operator} ${step.condition.value}`,
    };
  }

  // Execute step
  const parameters = interpolateParameters(step.parameters, instance.variables);
  const nextIndex = instance.currentStepIndex + 1;
  const nextStep = definition.steps[nextIndex];
  const nextExecAt = nextStep
    ? new Date(now.getTime() + nextStep.delayMs)
    : null;

  return {
    shouldExecute: true,
    step,
    actionType: step.actionType,
    parameters,
    nextStepIndex: nextIndex,
    nextExecutionAt: nextExecAt,
    completed: nextIndex >= definition.steps.length,
    skipped: false,
  };
}

function evaluateCondition(
  condition: CadenceCondition,
  variables: Record<string, unknown>,
): boolean {
  const value = variables[condition.variable];

  switch (condition.operator) {
    case "eq": return value === condition.value;
    case "neq": return value !== condition.value;
    case "gt": return Number(value) > Number(condition.value);
    case "lt": return Number(value) < Number(condition.value);
    case "exists": return value !== undefined && value !== null;
    case "not_exists": return value === undefined || value === null;
    default: return false;
  }
}

function interpolateParameters(
  params: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      result[key] = value.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
        const v = variables[varName];
        return v !== undefined ? String(v) : `{{${varName}}}`;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}
