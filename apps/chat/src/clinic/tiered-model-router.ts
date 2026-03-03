// NOTE: @experimental — Unused in production. ModelRouterFactory creates RedisModelRouter/InMemoryModelRouter directly.
// Preserved for potential future use as a step-type-aware routing strategy.

import type { ModelRouter, TokenUsageSummary } from "./model-router-types.js";
import type { StepType } from "@switchboard/schemas";
import { LLM_COST_TABLE } from "@switchboard/core";

/**
 * Model selection result for tiered routing.
 */
export interface ModelSelection {
  modelId: string;
  tier: "l1" | "l2" | "l3";
}

/**
 * TieredModelRouter — routes LLM requests to the appropriate model tier
 * based on StepType classification.
 *
 * - Classification/extraction → Haiku (L1, cheapest)
 * - Generation/analysis → Sonnet (L2, mid-tier)
 * - Complex reasoning → Opus (L3, most capable)
 *
 * Wraps an existing ModelRouter for per-tier budget tracking.
 */
export class TieredModelRouter implements ModelRouter {
  private inner: ModelRouter;
  readonly clinicId: string;

  /** Maps StepType → model tier */
  private static readonly STEP_TYPE_TO_TIER: Record<string, "l1" | "l2" | "l3"> = {
    FETCH: "l1",
    COMPUTE: "l1",
    LOG: "l1",
    SUMMARIZE: "l2",
    DECIDE: "l2",
    ASK_HUMAN: "l1",
    APPROVAL: "l1",
    EXECUTE: "l1",
  };

  /** Maps tier → model ID */
  private static readonly TIER_TO_MODEL: Record<string, string> = {
    l1: "claude-haiku-4",
    l2: "claude-sonnet-4",
    l3: "claude-opus-4",
  };

  constructor(inner: ModelRouter) {
    this.inner = inner;
    this.clinicId = inner.clinicId;
  }

  /**
   * Select the appropriate model for a given task type.
   * Returns the model ID string (conforming to ModelRouter interface).
   */
  selectModel(taskType: StepType): string {
    const tier = TieredModelRouter.STEP_TYPE_TO_TIER[taskType] ?? "l2";
    return TieredModelRouter.TIER_TO_MODEL[tier] ?? "claude-sonnet-4";
  }

  /**
   * Select the appropriate model with full tier info.
   */
  selectModelWithTier(taskType: StepType): ModelSelection {
    const tier = TieredModelRouter.STEP_TYPE_TO_TIER[taskType] ?? "l2";
    const modelId = TieredModelRouter.TIER_TO_MODEL[tier] ?? "claude-sonnet-4";
    return { modelId, tier };
  }

  /**
   * Get the model ID for a given task type.
   */
  getModelForTask(taskType: StepType): string {
    return this.selectModel(taskType);
  }

  /**
   * Get model cost info for a tier.
   */
  getModelCost(tier: "l1" | "l2" | "l3") {
    const model = TieredModelRouter.TIER_TO_MODEL[tier]!;
    return LLM_COST_TABLE[model] ?? null;
  }

  // Delegate ModelRouter interface methods to inner router
  async shouldUseLLM(orgId?: string): Promise<boolean> {
    return this.inner.shouldUseLLM(orgId);
  }

  async recordUsage(
    promptTokens: number,
    completionTokens: number,
    orgId?: string,
    modelId?: string,
  ): Promise<void> {
    return this.inner.recordUsage(promptTokens, completionTokens, orgId, modelId);
  }

  async getTodayUsage(orgId?: string): Promise<number> {
    return this.inner.getTodayUsage(orgId);
  }

  async getRemainingBudget(orgId?: string): Promise<number> {
    return this.inner.getRemainingBudget(orgId);
  }

  async getUsageSummary(
    orgId: string,
    period: "daily" | "weekly" | "monthly",
  ): Promise<TokenUsageSummary> {
    return this.inner.getUsageSummary(orgId, period);
  }

  async getTodayCostUSD(orgId?: string): Promise<number> {
    if (this.inner.getTodayCostUSD) {
      return this.inner.getTodayCostUSD(orgId);
    }
    return 0;
  }
}
