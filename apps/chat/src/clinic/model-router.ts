export interface ModelRouterConfig {
  dailyTokenBudget: number;
  clinicId: string;
}

interface TokenUsageEntry {
  promptTokens: number;
  completionTokens: number;
  timestamp: Date;
}

/**
 * In-memory token budget tracker.
 * Tracks LLM token usage per clinic per day and provides a kill switch
 * to degrade to template-only mode when budget is exceeded.
 *
 * v0: in-memory (single clinic, single process).
 * v1: persist to Redis for multi-process and multi-tenant.
 */
export class ModelRouter {
  private config: ModelRouterConfig;
  private usageLog: TokenUsageEntry[] = [];

  constructor(config: ModelRouterConfig) {
    this.config = config;
  }

  /** Returns true if the LLM should be called; false if budget is exceeded. */
  shouldUseLLM(): boolean {
    return this.getTodayUsage() < this.config.dailyTokenBudget;
  }

  /** Record token usage from an LLM call. */
  recordUsage(promptTokens: number, completionTokens: number): void {
    this.usageLog.push({
      promptTokens,
      completionTokens,
      timestamp: new Date(),
    });

    // Prune entries older than 48 hours to prevent unbounded growth
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    this.usageLog = this.usageLog.filter((e) => e.timestamp >= cutoff);
  }

  /** Total tokens used today (prompt + completion). */
  getTodayUsage(): number {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.usageLog
      .filter((e) => e.timestamp >= startOfDay)
      .reduce((sum, e) => sum + e.promptTokens + e.completionTokens, 0);
  }

  /** Remaining token budget for today. */
  getRemainingBudget(): number {
    return Math.max(0, this.config.dailyTokenBudget - this.getTodayUsage());
  }

  /** The configured clinic ID. */
  get clinicId(): string {
    return this.config.clinicId;
  }
}
