import type { ExecutionConstraints } from "../governance-types.js";
import type { IntentRegistration } from "../intent-registration.js";
import type { BudgetClass } from "../types.js";
import type { ModelSlot } from "../../model-router.js";

const BUDGET_TOKEN_LIMITS: Record<BudgetClass, number> = {
  cheap: 32_000,
  standard: 64_000,
  expensive: 128_000,
};

const BUDGET_TURN_LIMITS: Record<BudgetClass, number> = {
  cheap: 3,
  standard: 6,
  expensive: 10,
};

const BUDGET_MODEL_TIERS: Record<BudgetClass, ModelSlot[]> = {
  cheap: ["default"],
  standard: ["default", "premium"],
  expensive: ["default", "premium", "critical"],
};

export const DEFAULT_CONSTRAINTS: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium"],
  maxToolCalls: 20,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

export type ConstraintOverrides = Partial<ExecutionConstraints>;

export function resolveConstraints(
  registration: IntentRegistration,
  overrides?: ConstraintOverrides,
): ExecutionConstraints {
  return {
    allowedModelTiers: overrides?.allowedModelTiers ?? BUDGET_MODEL_TIERS[registration.budgetClass],
    maxToolCalls: overrides?.maxToolCalls ?? DEFAULT_CONSTRAINTS.maxToolCalls,
    maxLlmTurns: overrides?.maxLlmTurns ?? BUDGET_TURN_LIMITS[registration.budgetClass],
    maxTotalTokens: overrides?.maxTotalTokens ?? BUDGET_TOKEN_LIMITS[registration.budgetClass],
    maxRuntimeMs: overrides?.maxRuntimeMs ?? registration.timeoutMs,
    maxWritesPerExecution:
      overrides?.maxWritesPerExecution ?? DEFAULT_CONSTRAINTS.maxWritesPerExecution,
    trustLevel: overrides?.trustLevel ?? DEFAULT_CONSTRAINTS.trustLevel,
  };
}
