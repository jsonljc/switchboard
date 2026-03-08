import type { StepExecutionResult } from "./types.js";
import { getNestedValue } from "../utils/nested-value.js";

/** Minimal interface for entity graph resolution (full impl lives in entity-graph module). */
export interface EntityGraphService {
  resolveToCartridge(
    sourceRef: { cartridgeId: string; entityType: string; entityId: string },
    targetCartridgeId: string,
    targetEntityType: string,
    organizationId: string,
  ): Promise<string | null>;
}

export class BindingResolutionError extends Error {
  constructor(
    public readonly expression: string,
    public readonly reason: string,
  ) {
    super(`Failed to resolve binding "${expression}": ${reason}`);
    this.name = "BindingResolutionError";
  }
}

export interface BindingContext {
  stepResults: StepExecutionResult[];
  entityGraphService?: EntityGraphService;
  organizationId?: string;
}

/**
 * Resolves binding expressions in data-flow step parameters.
 *
 * Binding expression grammar:
 *   $step[N].result.path.to.value    → Step N's result
 *   $step[N].externalRefs.key        → Step N's result externalRefs shorthand
 *   $prev.result.path.to.value       → Previous step's result
 *   $prev.externalRefs.key           → Previous step's externalRefs
 *   $entity.cartridgeId.entityType   → Entity graph resolution
 */
export async function resolveBindings(
  parameters: Record<string, unknown>,
  stepIndex: number,
  context: BindingContext,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parameters)) {
    resolved[key] = await resolveValue(value, stepIndex, context);
  }

  return resolved;
}

async function resolveValue(
  value: unknown,
  stepIndex: number,
  context: BindingContext,
): Promise<unknown> {
  if (typeof value === "string" && value.startsWith("$")) {
    return resolveExpression(value, stepIndex, context);
  }

  if (
    (typeof value === "string" && value.includes("$step[")) ||
    (typeof value === "string" && value.includes("$prev."))
  ) {
    // String interpolation: "Treatment: $step[0].result.data.treatmentType"
    let result = value as string;
    const bindingPattern = /\$(?:step\[\d+\]|prev)\.[a-zA-Z0-9_.]+/g;
    const matches = result.match(bindingPattern);
    if (matches) {
      for (const match of matches) {
        const resolved = await resolveExpression(match, stepIndex, context);
        result = result.replace(match, resolved !== undefined ? String(resolved) : "");
      }
    }
    return result;
  }

  if (Array.isArray(value)) {
    const results: unknown[] = [];
    for (const item of value) {
      results.push(await resolveValue(item, stepIndex, context));
    }
    return results;
  }

  if (value !== null && typeof value === "object") {
    return resolveBindings(value as Record<string, unknown>, stepIndex, context);
  }

  return value;
}

async function resolveExpression(
  expr: string,
  stepIndex: number,
  context: BindingContext,
): Promise<unknown> {
  // $entity.cartridgeId.entityType
  if (expr.startsWith("$entity.")) {
    return resolveEntityBinding(expr, context);
  }

  // $prev.result.path or $prev.externalRefs.key
  if (expr.startsWith("$prev.")) {
    if (stepIndex === 0) {
      throw new BindingResolutionError(expr, "Cannot use $prev on step 0");
    }
    const prevResult = context.stepResults[stepIndex - 1];
    if (!prevResult) {
      throw new BindingResolutionError(expr, `Previous step ${stepIndex - 1} has no result`);
    }
    const path = expr.slice("$prev.".length);
    return resolveResultPath(prevResult, path, expr);
  }

  // $step[N].result.path or $step[N].externalRefs.key
  const stepMatch = expr.match(/^\$step\[(\d+)\]\.(.+)$/);
  if (stepMatch) {
    const targetIndex = parseInt(stepMatch[1]!, 10);
    const path = stepMatch[2]!;
    const targetResult = context.stepResults[targetIndex];
    if (!targetResult) {
      throw new BindingResolutionError(expr, `Step ${targetIndex} has no result yet`);
    }
    return resolveResultPath(targetResult, path, expr);
  }

  throw new BindingResolutionError(expr, "Unknown binding expression format");
}

function resolveResultPath(stepResult: StepExecutionResult, path: string, _expr: string): unknown {
  // Build a navigable object from the step result
  const resultObj: Record<string, unknown> = {
    result: stepResult.result,
    externalRefs: stepResult.resolvedParameters,
    resolvedParameters: stepResult.resolvedParameters,
    outcome: stepResult.outcome,
    envelopeId: stepResult.envelopeId,
  };

  // Also expose result.data, result.externalRefs etc if result is an object
  if (stepResult.result && typeof stepResult.result === "object") {
    const r = stepResult.result as Record<string, unknown>;
    resultObj.result = r;
  }

  return getNestedValue(resultObj, path);
}

async function resolveEntityBinding(expr: string, context: BindingContext): Promise<unknown> {
  if (!context.entityGraphService) {
    throw new BindingResolutionError(expr, "EntityGraphService not configured");
  }
  if (!context.organizationId) {
    throw new BindingResolutionError(expr, "organizationId required for entity resolution");
  }

  // $entity.cartridgeId.entityType
  const parts = expr.slice("$entity.".length).split(".");
  if (parts.length < 2) {
    throw new BindingResolutionError(expr, "Expected format: $entity.cartridgeId.entityType");
  }

  const targetCartridgeId = parts[0]!;
  const targetEntityType = parts[1]!;

  // We need a source entity ref from the current context.
  // This will be resolved during execution when we have the step's entity context.
  // For now, return a marker that the executor can resolve.
  return `__entity_resolve__:${targetCartridgeId}:${targetEntityType}`;
}
