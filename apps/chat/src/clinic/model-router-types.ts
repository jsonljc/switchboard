export interface ModelRouterConfig {
  dailyTokenBudget: number;
  clinicId: string;
}

export interface TokenUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelRouter {
  shouldUseLLM(orgId?: string): Promise<boolean>;
  recordUsage(promptTokens: number, completionTokens: number, orgId?: string): Promise<void>;
  getTodayUsage(orgId?: string): Promise<number>;
  getRemainingBudget(orgId?: string): Promise<number>;
  getUsageSummary(orgId: string, period: "daily" | "weekly" | "monthly"): Promise<TokenUsageSummary>;
  readonly clinicId: string;
}
