import type { PolicyCondition, PolicyConditionOperator, PolicyRule } from "@switchboard/schemas";
import { getNestedValue } from "../utils/nested-value.js";

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

function evaluateCondition(
  condition: PolicyCondition,
  context: EvaluationContext,
): ConditionResult {
  const actual = getNestedValue(context as unknown as Record<string, unknown>, condition.field);
  const expected = condition.value;
  const matched = evaluateOperator(condition.operator, actual, expected);

  return { field: condition.field, operator: condition.operator, expected, actual, matched };
}

function evaluateOperator(
  operator: PolicyConditionOperator,
  actual: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return evaluateNumericComparison(actual, expected, (a, e) => a > e);
    case "gte":
      return evaluateNumericComparison(actual, expected, (a, e) => a >= e);
    case "lt":
      return evaluateNumericComparison(actual, expected, (a, e) => a < e);
    case "lte":
      return evaluateNumericComparison(actual, expected, (a, e) => a <= e);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "contains":
      return evaluateStringContains(actual, expected, true);
    case "not_contains":
      return evaluateStringContains(actual, expected, false);
    case "matches":
      return evaluateRegexMatch(actual, expected);
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    default:
      return false;
  }
}

function evaluateNumericComparison(
  actual: unknown,
  expected: unknown,
  compare: (a: number, e: number) => boolean,
): boolean {
  return typeof actual === "number" && typeof expected === "number" && compare(actual, expected);
}

function evaluateStringContains(
  actual: unknown,
  expected: unknown,
  shouldContain: boolean,
): boolean {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }
  const contains = actual.includes(expected);
  return shouldContain ? contains : !contains;
}

function evaluateRegexMatch(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }

  // ReDoS protection: reject overly long patterns or inputs
  if (expected.length > 256 || actual.length > 10_000) {
    return false;
  }

  // Reject patterns with nested quantifiers, repeated wildcards, or adjacent unbounded groups
  if (
    /(\+|\*|\{)\s*\)(\+|\*|\?)/.test(expected) ||
    /(\+|\*)\+/.test(expected) ||
    /\.\*.*\.\*/.test(expected) ||
    /\.\+.*\.\+/.test(expected)
  ) {
    return false;
  }

  try {
    return new RegExp(expected).test(actual);
  } catch {
    return false;
  }
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
      matched = conditionResults.every((r) => r.matched) && childResults.every((r) => r.matched);
      break;
    case "OR":
      matched = conditionResults.some((r) => r.matched) || childResults.some((r) => r.matched);
      break;
    case "NOT": {
      // NOT applies to the first child/condition group
      const innerMatched =
        conditionResults.every((r) => r.matched) && childResults.every((r) => r.matched);
      matched = !innerMatched;
      break;
    }
    default:
      matched = false;
  }

  return { matched, conditionResults: allConditionResults };
}
