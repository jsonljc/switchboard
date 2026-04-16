// packages/core/src/creative-pipeline/ugc/provider-performance.ts

// ── Types ──

export interface ProviderPerformanceHistory {
  passRateByProvider: Record<string, number>;
  avgLatencyByProvider: Record<string, number>;
  costByProvider: Record<string, number>;
}

export interface PerformanceRecord {
  provider: string;
  passed: boolean;
  latencyMs: number;
  cost: number;
}

// ── Tracker ──

interface ProviderStats {
  totalAttempts: number;
  passedAttempts: number;
  totalLatencyMs: number;
  totalCost: number;
}

export class ProviderPerformanceTracker {
  private stats: Record<string, ProviderStats> = {};

  record(record: PerformanceRecord): void {
    if (!this.stats[record.provider]) {
      this.stats[record.provider] = {
        totalAttempts: 0,
        passedAttempts: 0,
        totalLatencyMs: 0,
        totalCost: 0,
      };
    }
    const s = this.stats[record.provider];
    s.totalAttempts++;
    if (record.passed) s.passedAttempts++;
    s.totalLatencyMs += record.latencyMs;
    s.totalCost += record.cost;
  }

  getHistory(): ProviderPerformanceHistory {
    const passRateByProvider: Record<string, number> = {};
    const avgLatencyByProvider: Record<string, number> = {};
    const costByProvider: Record<string, number> = {};

    for (const [provider, s] of Object.entries(this.stats)) {
      passRateByProvider[provider] = s.totalAttempts > 0 ? s.passedAttempts / s.totalAttempts : 0;
      avgLatencyByProvider[provider] = s.totalAttempts > 0 ? s.totalLatencyMs / s.totalAttempts : 0;
      costByProvider[provider] = s.totalAttempts > 0 ? s.totalCost / s.totalAttempts : 0;
    }

    return { passRateByProvider, avgLatencyByProvider, costByProvider };
  }

  static fromHistory(history: ProviderPerformanceHistory): ProviderPerformanceTracker {
    const tracker = new ProviderPerformanceTracker();
    // Initialize with synthetic stats that reproduce the given rates
    for (const provider of Object.keys(history.passRateByProvider)) {
      const passRate = history.passRateByProvider[provider] ?? 0;
      const avgLatency = history.avgLatencyByProvider[provider] ?? 0;
      const avgCost = history.costByProvider[provider] ?? 0;
      // Use 100 as synthetic sample size to minimize rounding error when reconstructing rates
      const sampleSize = 100;
      tracker.stats[provider] = {
        totalAttempts: sampleSize,
        passedAttempts: Math.round(passRate * sampleSize),
        totalLatencyMs: avgLatency * sampleSize,
        totalCost: avgCost * sampleSize,
      };
    }
    return tracker;
  }
}

export function emptyPerformanceHistory(): ProviderPerformanceHistory {
  return { passRateByProvider: {}, avgLatencyByProvider: {}, costByProvider: {} };
}
