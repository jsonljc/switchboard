// ---------------------------------------------------------------------------
// LLM Cost Table — Per-model cost computation
// ---------------------------------------------------------------------------

/**
 * Cost per 1,000 tokens for each supported model.
 * Prices should be updated when provider pricing changes.
 */
export interface ModelCostEntry {
  /** Model identifier (e.g. "claude-sonnet-4") */
  modelId: string;
  /** Human-readable model name */
  displayName: string;
  /** Cost per 1K input (prompt) tokens in USD */
  inputCostPer1K: number;
  /** Cost per 1K output (completion) tokens in USD */
  outputCostPer1K: number;
  /** Recommended use cases */
  useCases: string[];
}

/**
 * Default cost table for supported LLM models.
 * Prices in USD per 1,000 tokens.
 */
export const LLM_COST_TABLE: Record<string, ModelCostEntry> = {
  "claude-opus-4": {
    modelId: "claude-opus-4",
    displayName: "Claude Opus 4",
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    useCases: ["complex reasoning", "creative generation", "multi-step analysis"],
  },
  "claude-sonnet-4": {
    modelId: "claude-sonnet-4",
    displayName: "Claude Sonnet 4",
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    useCases: ["conversation", "scoring", "diagnostic analysis"],
  },
  "claude-haiku-4": {
    modelId: "claude-haiku-4",
    displayName: "Claude Haiku 4",
    inputCostPer1K: 0.001,
    outputCostPer1K: 0.005,
    useCases: ["templates", "classification", "simple extraction"],
  },
  "gpt-4o": {
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    inputCostPer1K: 0.005,
    outputCostPer1K: 0.015,
    useCases: ["creative generation", "complex reasoning"],
  },
  "gpt-4o-mini": {
    modelId: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    inputCostPer1K: 0.00015,
    outputCostPer1K: 0.0006,
    useCases: ["simple extraction", "classification", "routing"],
  },
};

/** Default model used when model is not specified */
export const DEFAULT_MODEL_ID = "claude-sonnet-4";

/**
 * Compute the USD cost for a given token usage.
 */
export function computeTokenCostUSD(
  promptTokens: number,
  completionTokens: number,
  modelId?: string,
): { inputCost: number; outputCost: number; totalCost: number; modelId: string } {
  const model = modelId ?? DEFAULT_MODEL_ID;
  const entry = LLM_COST_TABLE[model];

  if (!entry) {
    // Fall back to default model pricing if unknown model
    const fallback = LLM_COST_TABLE[DEFAULT_MODEL_ID]!;
    return {
      inputCost: (promptTokens / 1000) * fallback.inputCostPer1K,
      outputCost: (completionTokens / 1000) * fallback.outputCostPer1K,
      totalCost:
        (promptTokens / 1000) * fallback.inputCostPer1K +
        (completionTokens / 1000) * fallback.outputCostPer1K,
      modelId: model,
    };
  }

  const inputCost = (promptTokens / 1000) * entry.inputCostPer1K;
  const outputCost = (completionTokens / 1000) * entry.outputCostPer1K;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    modelId: model,
  };
}

/**
 * Convert a USD budget to an approximate token budget for a given model.
 * Assumes a 1:1 prompt-to-completion ratio for estimation.
 */
export function usdToTokenBudget(
  budgetUSD: number,
  modelId?: string,
): { promptTokenBudget: number; completionTokenBudget: number; totalTokenBudget: number } {
  const model = modelId ?? DEFAULT_MODEL_ID;
  const entry = LLM_COST_TABLE[model] ?? LLM_COST_TABLE[DEFAULT_MODEL_ID]!;

  // Assume equal split between prompt and completion for budget estimation
  const halfBudget = budgetUSD / 2;
  const promptTokenBudget = Math.floor((halfBudget / entry.inputCostPer1K) * 1000);
  const completionTokenBudget = Math.floor((halfBudget / entry.outputCostPer1K) * 1000);

  return {
    promptTokenBudget,
    completionTokenBudget,
    totalTokenBudget: promptTokenBudget + completionTokenBudget,
  };
}

/**
 * Get cost entry for a model, or null if not found.
 */
export function getModelCost(modelId: string): ModelCostEntry | null {
  return LLM_COST_TABLE[modelId] ?? null;
}

/**
 * List all available models with their costs.
 */
export function listModelCosts(): ModelCostEntry[] {
  return Object.values(LLM_COST_TABLE);
}
