// ---------------------------------------------------------------------------
// Cadence Scheduler — Time-based trigger evaluator
// ---------------------------------------------------------------------------

import type { CadenceInstance, CadenceDefinition } from "./types.js";
import { evaluateCadenceStep, type CadenceEvaluation } from "./engine.js";

export interface SchedulerResult {
  instanceId: string;
  evaluation: CadenceEvaluation;
}

/**
 * Evaluate all active cadence instances that are due for execution.
 */
export function evaluatePendingCadences(
  instances: CadenceInstance[],
  definitions: Map<string, CadenceDefinition>,
  now: Date = new Date(),
): SchedulerResult[] {
  const results: SchedulerResult[] = [];

  for (const instance of instances) {
    if (instance.status !== "active") continue;

    // Check if execution is due
    if (instance.nextExecutionAt && now < instance.nextExecutionAt) continue;

    const definition = definitions.get(instance.cadenceDefinitionId);
    if (!definition) continue;

    const evaluation = evaluateCadenceStep(definition, instance, now);
    results.push({ instanceId: instance.id, evaluation });
  }

  return results;
}

/**
 * Apply an evaluation result to update a cadence instance.
 */
export function applyCadenceEvaluation(
  instance: CadenceInstance,
  evaluation: CadenceEvaluation,
): CadenceInstance {
  const updated = { ...instance };

  if (evaluation.completed) {
    updated.status = "completed";
    updated.nextExecutionAt = null;
  } else {
    updated.currentStepIndex = evaluation.nextStepIndex;
    updated.nextExecutionAt = evaluation.nextExecutionAt;
  }

  if (evaluation.shouldExecute) {
    updated.completedSteps = [...updated.completedSteps, instance.currentStepIndex];
  } else if (evaluation.skipped) {
    updated.skippedSteps = [...updated.skippedSteps, instance.currentStepIndex];
  }

  return updated;
}
