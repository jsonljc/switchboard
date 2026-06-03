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

/**
 * Map a concrete (possibly versioned) model id to a LLM_COST_TABLE key.
 * The router emits ids like "claude-sonnet-4-6" / "claude-haiku-4-5-20251001";
 * the table is keyed by family ("claude-sonnet-4"). Substring-match the family.
 */
function normalizeModelId(modelId: string): string {
  // embedding models are not priced on the chat-cost path; pass through to the table's unknown→default fallback
  if (modelId.includes("voyage")) return modelId;
  if (modelId.includes("opus")) return "claude-opus-4";
  if (modelId.includes("sonnet")) return "claude-sonnet-4";
  if (modelId.includes("haiku")) return "claude-haiku-4";
  return modelId; // GPT ids and exact table keys pass through unchanged
}

// Anthropic cache-token pricing multipliers relative to base input price.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Compute the USD cost for a single skill execution, including prompt-cache tokens.
 * Cache reads are billed at 0.1x the base input rate; cache writes at 1.25x.
 */
export function computeExecutionCostUSD(input: {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): { totalCost: number; modelId: string } {
  const key = normalizeModelId(input.model ?? DEFAULT_MODEL_ID);
  const entry = LLM_COST_TABLE[key] ?? LLM_COST_TABLE[DEFAULT_MODEL_ID]!;
  const inPerTok = entry.inputCostPer1K / 1000;
  const outPerTok = entry.outputCostPer1K / 1000;
  const totalCost =
    input.inputTokens * inPerTok +
    input.outputTokens * outPerTok +
    (input.cacheReadTokens ?? 0) * inPerTok * CACHE_READ_MULTIPLIER +
    (input.cacheCreationTokens ?? 0) * inPerTok * CACHE_WRITE_MULTIPLIER;
  return { totalCost, modelId: input.model ?? DEFAULT_MODEL_ID };
}
