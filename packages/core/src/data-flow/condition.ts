/**
 * Evaluate a simple condition expression for data-flow step gating.
 *
 * Supported syntax:
 *   "$prev.result.success === true"
 *   "$step[0].outcome === 'executed'"
 *   "$prev.result.data.value > 1000"
 *
 * Returns true if condition is met, false otherwise.
 * Returns true for null/empty conditions (no gating).
 */
import type { StepExecutionResult } from "./types.js";

export function evaluateCondition(
  condition: string | null,
  stepIndex: number,
  stepResults: StepExecutionResult[],
): boolean {
  if (!condition || condition.trim() === "") return true;

  try {
    // Parse: left operator right
    const match = condition.match(/^(.+?)\s*(===|!==|>|>=|<|<=)\s*(.+)$/);
    if (!match) return true; // Unparseable conditions default to true (don't block)

    const [, leftExpr, operator, rightExpr] = match;
    const leftValue = resolveConditionValue(leftExpr!.trim(), stepIndex, stepResults);
    const rightValue = parseConditionLiteral(rightExpr!.trim());

    switch (operator) {
      case "===":
        return leftValue === rightValue;
      case "!==":
        return leftValue !== rightValue;
      case ">":
        return typeof leftValue === "number" && typeof rightValue === "number" && leftValue > rightValue;
      case ">=":
        return typeof leftValue === "number" && typeof rightValue === "number" && leftValue >= rightValue;
      case "<":
        return typeof leftValue === "number" && typeof rightValue === "number" && leftValue < rightValue;
      case "<=":
        return typeof leftValue === "number" && typeof rightValue === "number" && leftValue <= rightValue;
      default:
        return true;
    }
  } catch {
    // Condition evaluation errors default to true (don't block)
    return true;
  }
}

function resolveConditionValue(
  expr: string,
  stepIndex: number,
  stepResults: StepExecutionResult[],
): unknown {
  if (expr.startsWith("$prev.")) {
    if (stepIndex === 0) return undefined;
    const prevResult = stepResults[stepIndex - 1];
    if (!prevResult) return undefined;
    const path = expr.slice("$prev.".length);
    return getFromStepResult(prevResult, path);
  }

  const stepMatch = expr.match(/^\$step\[(\d+)\]\.(.+)$/);
  if (stepMatch) {
    const targetIndex = parseInt(stepMatch[1]!, 10);
    const path = stepMatch[2]!;
    const targetResult = stepResults[targetIndex];
    if (!targetResult) return undefined;
    return getFromStepResult(targetResult, path);
  }

  // Literal value
  return parseConditionLiteral(expr);
}

function getFromStepResult(result: StepExecutionResult, path: string): unknown {
  const obj: Record<string, unknown> = {
    result: result.result,
    outcome: result.outcome,
    resolvedParameters: result.resolvedParameters,
    conditionMet: result.conditionMet,
    envelopeId: result.envelopeId,
    error: result.error,
  };
  return getNestedValue(obj, path);
}

function parseConditionLiteral(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value === "undefined") return undefined;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  const num = Number(value);
  if (!isNaN(num)) return num;
  return value;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
