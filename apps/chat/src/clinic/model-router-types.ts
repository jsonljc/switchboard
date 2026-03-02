export interface ModelRouterConfig {
  dailyTokenBudget: number;
  /** Daily budget in USD. When set, this takes precedence over dailyTokenBudget. */
  dailyBudgetUSD?: number;
  clinicId: string;
}

export interface TokenUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Estimated cost in USD (null if cost table not available) */
  estimatedCostUSD?: number;
}

export interface ModelRouter {
  shouldUseLLM(orgId?: string): Promise<boolean>;
  recordUsage(promptTokens: number, completionTokens: number, orgId?: string, modelId?: string): Promise<void>;
  getTodayUsage(orgId?: string): Promise<number>;
  getRemainingBudget(orgId?: string): Promise<number>;
  getUsageSummary(orgId: string, period: "daily" | "weekly" | "monthly"): Promise<TokenUsageSummary>;
  /** Get estimated USD cost for today (null if not tracked) */
  getTodayCostUSD?(orgId?: string): Promise<number>;
  readonly clinicId: string;
}
