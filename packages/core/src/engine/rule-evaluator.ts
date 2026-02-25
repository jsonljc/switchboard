import type { PolicyCondition, PolicyConditionOperator, PolicyRule } from "@switchboard/schemas";

export interface EvaluationContext {
  actionType: string;
  parameters: Record<string, unknown>;
  cartridgeId: string;
  principalId: string;
  organizationId: string | null;
  riskCategory: string;
  metadata: Record<string, unknown>;
}

export interface ConditionResult {
  field: string;
  operator: PolicyConditionOperator;
  expected: unknown;
  actual: unknown;
  matched: boolean;
}

export interface RuleResult {
  matched: boolean;
  conditionResults: ConditionResult[];
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

function evaluateCondition(condition: PolicyCondition, context: EvaluationContext): ConditionResult {
  const actual = getNestedValue(context as unknown as Record<string, unknown>, condition.field);
  const expected = condition.value;
  let matched = false;

  switch (condition.operator) {
    case "eq":
      matched = actual === expected;
      break;
    case "neq":
      matched = actual !== expected;
      break;
    case "gt":
      matched = typeof actual === "number" && typeof expected === "number" && actual > expected;
      break;
    case "gte":
      matched = typeof actual === "number" && typeof expected === "number" && actual >= expected;
      break;
    case "lt":
      matched = typeof actual === "number" && typeof expected === "number" && actual < expected;
      break;
    case "lte":
      matched = typeof actual === "number" && typeof expected === "number" && actual <= expected;
      break;
    case "in":
      matched = Array.isArray(expected) && expected.includes(actual);
      break;
    case "not_in":
      matched = Array.isArray(expected) && !expected.includes(actual);
      break;
    case "contains":
      matched = typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
      break;
    case "not_contains":
      matched = typeof actual === "string" && typeof expected === "string" && !actual.includes(expected);
      break;
    case "matches":
      if (typeof actual === "string" && typeof expected === "string") {
        // ReDoS protection: reject overly long patterns or inputs
        if (expected.length > 256 || actual.length > 10_000) {
          matched = false;
        // Reject patterns with nested quantifiers, repeated wildcards, or adjacent unbounded groups
        } else if (
          /(\+|\*|\{)\s*\)(\+|\*|\?)/.test(expected) ||
          /(\+|\*)\+/.test(expected) ||
          /\.\*.*\.\*/.test(expected) ||
          /\.\+.*\.\+/.test(expected)
        ) {
          // Potentially dangerous pattern — reject rather than risk catastrophic backtracking
          matched = false;
        } else {
          try {
            matched = new RegExp(expected).test(actual);
          } catch {
            matched = false;
          }
        }
      }
      break;
    case "exists":
      matched = actual !== undefined && actual !== null;
      break;
    case "not_exists":
      matched = actual === undefined || actual === null;
      break;
  }

  return { field: condition.field, operator: condition.operator, expected, actual, matched };
}

export function evaluateRule(rule: PolicyRule, context: EvaluationContext): RuleResult {
  const allConditionResults: ConditionResult[] = [];

  // Evaluate direct conditions
  const conditions = (rule.conditions ?? []) as PolicyCondition[];
  const conditionResults = conditions.map((c) => evaluateCondition(c, context));
  allConditionResults.push(...conditionResults);

  // Evaluate child rules
  const children = (rule.children ?? []) as PolicyRule[];
  const childResults = children.map((child) => evaluateRule(child, context));
  for (const cr of childResults) {
    allConditionResults.push(...cr.conditionResults);
  }

  const composition = rule.composition ?? "AND";
  let matched: boolean;

  switch (composition) {
    case "AND":
      matched =
        conditionResults.every((r) => r.matched) &&
        childResults.every((r) => r.matched);
      break;
    case "OR":
      matched =
        conditionResults.some((r) => r.matched) ||
        childResults.some((r) => r.matched);
      break;
    case "NOT": {
      // NOT applies to the first child/condition group
      const innerMatched =
        conditionResults.every((r) => r.matched) &&
        childResults.every((r) => r.matched);
      matched = !innerMatched;
      break;
    }
    default:
      matched = false;
  }

  return { matched, conditionResults: allConditionResults };
}
