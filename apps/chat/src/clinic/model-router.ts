import type { ModelRouter, ModelRouterConfig, TokenUsageSummary } from "./model-router-types.js";

// Re-export interface + types for existing consumers
export type { ModelRouter, ModelRouterConfig, TokenUsageSummary } from "./model-router-types.js";

interface TokenUsageEntry {
  promptTokens: number;
  completionTokens: number;
  timestamp: Date;
  orgId?: string;
}

/**
 * In-memory token budget tracker.
 * Tracks LLM token usage per org per day and provides a kill switch
 * to degrade to template-only mode when budget is exceeded.
 */
export class InMemoryModelRouter implements ModelRouter {
  private config: ModelRouterConfig;
  private usageLog: TokenUsageEntry[] = [];

  constructor(config: ModelRouterConfig) {
    this.config = config;
  }

  async shouldUseLLM(orgId?: string): Promise<boolean> {
    return (await this.getTodayUsage(orgId)) < this.config.dailyTokenBudget;
  }

  async recordUsage(promptTokens: number, completionTokens: number, orgId?: string): Promise<void> {
    this.usageLog.push({
      promptTokens,
      completionTokens,
      timestamp: new Date(),
      orgId,
    });

    // Prune entries older than 48 hours to prevent unbounded growth
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    this.usageLog = this.usageLog.filter((e) => e.timestamp >= cutoff);
  }

  async getTodayUsage(orgId?: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.usageLog
      .filter((e) => e.timestamp >= startOfDay && (!orgId || e.orgId === orgId))
      .reduce((sum, e) => sum + e.promptTokens + e.completionTokens, 0);
  }

  async getRemainingBudget(orgId?: string): Promise<number> {
    return Math.max(0, this.config.dailyTokenBudget - (await this.getTodayUsage(orgId)));
  }

  async getUsageSummary(orgId: string, period: "daily" | "weekly" | "monthly"): Promise<TokenUsageSummary> {
    const now = new Date();
    let cutoff: Date;

    if (period === "daily") {
      cutoff = new Date(now);
      cutoff.setHours(0, 0, 0, 0);
    } else if (period === "weekly") {
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const entries = this.usageLog.filter(
      (e) => e.timestamp >= cutoff && (!orgId || e.orgId === orgId),
    );

    const promptTokens = entries.reduce((sum, e) => sum + e.promptTokens, 0);
    const completionTokens = entries.reduce((sum, e) => sum + e.completionTokens, 0);

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  get clinicId(): string {
    return this.config.clinicId;
  }
}
