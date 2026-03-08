// ---------------------------------------------------------------------------
// Account Memory — Historical learning / persistent optimization records
// ---------------------------------------------------------------------------
// Stores past optimizations and outcomes so the system can learn what works
// for each account. In-memory storage keyed by accountId; supports
// export/import for persistence by the orchestrator layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptimizationActionType =
  | 'budget_increase' | 'budget_decrease' | 'budget_reallocate'
  | 'bid_strategy_change' | 'targeting_change'
  | 'creative_rotation' | 'creative_pause' | 'creative_launch'
  | 'campaign_pause' | 'campaign_resume'
  | 'adset_pause' | 'adset_resume'
  | 'audience_change' | 'placement_change'
  | 'dayparting_change' | 'rule_created';

export interface OptimizationRecord {
  id: string;
  accountId: string;
  timestamp: string;
  /** What action was taken */
  actionType: OptimizationActionType;
  /** The entity that was modified */
  entityId: string;
  entityType: 'campaign' | 'adset' | 'ad' | 'account';
  /** Parameters of the change */
  changeDescription: string;
  parameters: Record<string, unknown>;
  /** Metrics before the change */
  metricsBefore: {
    spend?: number;
    conversions?: number;
    cpa?: number;
    roas?: number;
    ctr?: number;
    impressions?: number;
  };
  /** Metrics after the change (populated by outcome tracking) */
  metricsAfter?: {
    spend?: number;
    conversions?: number;
    cpa?: number;
    roas?: number;
    ctr?: number;
    impressions?: number;
    daysAfterChange: number;
  };
  /** Computed outcome */
  outcome?: OptimizationOutcome;
  /** Finding that triggered this action (if any) */
  triggeringFinding?: string;
}

export interface OptimizationOutcome {
  status: 'positive' | 'negative' | 'neutral' | 'pending';
  /** Primary metric change (e.g. CPA delta) */
  primaryMetricDelta: number;
  primaryMetricDeltaPercent: number;
  /** Confidence in the outcome */
  confidence: 'high' | 'medium' | 'low';
  /** Summary */
  summary: string;
}

export interface AccountInsight {
  actionType: OptimizationActionType;
  totalAttempts: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  neutralOutcomes: number;
  pendingOutcomes: number;
  successRate: number;
  avgPositiveImpact: number;
  avgNegativeImpact: number;
  /** Best performing parameters for this action type */
  bestParameters?: Record<string, unknown>;
  /** Recommendation based on historical performance */
  recommendation: string;
}

export interface AccountMemorySnapshot {
  accountId: string;
  totalRecords: number;
  oldestRecord: string;
  newestRecord: string;
  insights: AccountInsight[];
  overallSuccessRate: number;
}

export interface MemoryRecommendation {
  confidence: string;
  recommendation: string;
  historicalSuccessRate: number;
  recentTrend: 'improving' | 'declining' | 'stable';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `opt_${Date.now()}_${idCounter}`;
}

// ---------------------------------------------------------------------------
// AccountMemory
// ---------------------------------------------------------------------------

export class AccountMemory {
  private records = new Map<string, OptimizationRecord[]>();

  // -------------------------------------------------------------------------
  // (a) recordOptimization
  // -------------------------------------------------------------------------

  recordOptimization(
    record: Omit<OptimizationRecord, 'id' | 'timestamp'>,
  ): OptimizationRecord {
    const full: OptimizationRecord = {
      ...record,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };

    const accountRecords = this.records.get(full.accountId);
    if (accountRecords) {
      accountRecords.push(full);
    } else {
      this.records.set(full.accountId, [full]);
    }

    return full;
  }

  // -------------------------------------------------------------------------
  // (b) recordOutcome
  // -------------------------------------------------------------------------

  recordOutcome(
    recordId: string,
    metricsAfter: OptimizationRecord['metricsAfter'],
  ): OptimizationRecord {
    const record = this.findRecordById(recordId);
    if (!record) {
      throw new Error(`Optimization record not found: ${recordId}`);
    }

    record.metricsAfter = metricsAfter;
    record.outcome = this.computeOutcome(record.metricsBefore, metricsAfter);

    return record;
  }

  private computeOutcome(
    before: OptimizationRecord['metricsBefore'],
    after: OptimizationRecord['metricsAfter'],
  ): OptimizationOutcome {
    if (!after) {
      return {
        status: 'pending',
        primaryMetricDelta: 0,
        primaryMetricDeltaPercent: 0,
        confidence: 'low',
        summary: 'Awaiting post-change metrics',
      };
    }

    // Determine confidence based on daysAfterChange
    let confidence: 'high' | 'medium' | 'low';
    if (after.daysAfterChange > 7) {
      confidence = 'high';
    } else if (after.daysAfterChange >= 3) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    // Choose primary metric: CPA first, then ROAS, then CTR
    let delta = 0;
    let deltaPercent = 0;
    let status: 'positive' | 'negative' | 'neutral' = 'neutral';
    let metricName = '';

    if (before.cpa !== undefined && before.cpa > 0 && after.cpa !== undefined && after.cpa > 0) {
      metricName = 'CPA';
      delta = after.cpa - before.cpa;
      deltaPercent = (delta / before.cpa) * 100;
      // For CPA, decrease is positive (lower cost per acquisition is better)
      if (deltaPercent < -5) {
        status = 'positive';
      } else if (deltaPercent > 5) {
        status = 'negative';
      } else {
        status = 'neutral';
      }
    } else if (before.roas !== undefined && before.roas > 0 && after.roas !== undefined && after.roas > 0) {
      metricName = 'ROAS';
      delta = after.roas - before.roas;
      deltaPercent = (delta / before.roas) * 100;
      // For ROAS, increase is positive (higher return is better)
      if (deltaPercent > 5) {
        status = 'positive';
      } else if (deltaPercent < -5) {
        status = 'negative';
      } else {
        status = 'neutral';
      }
    } else if (before.ctr !== undefined && before.ctr > 0 && after.ctr !== undefined && after.ctr > 0) {
      metricName = 'CTR';
      delta = after.ctr - before.ctr;
      deltaPercent = (delta / before.ctr) * 100;
      // For CTR, increase is positive
      if (deltaPercent > 5) {
        status = 'positive';
      } else if (deltaPercent < -5) {
        status = 'negative';
      } else {
        status = 'neutral';
      }
    }

    const directionStr =
      status === 'positive' ? 'improved' :
      status === 'negative' ? 'worsened' :
      'remained stable';

    const summary = metricName
      ? `${metricName} ${directionStr} by ${Math.abs(deltaPercent).toFixed(1)}% (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}) over ${after.daysAfterChange} day(s)`
      : `Insufficient metric data to determine outcome after ${after.daysAfterChange} day(s)`;

    return {
      status,
      primaryMetricDelta: Math.round(delta * 100) / 100,
      primaryMetricDeltaPercent: Math.round(deltaPercent * 10) / 10,
      confidence,
      summary,
    };
  }

  // -------------------------------------------------------------------------
  // (c) getAccountInsights
  // -------------------------------------------------------------------------

  getAccountInsights(accountId: string): AccountMemorySnapshot {
    const records = this.records.get(accountId) ?? [];

    if (records.length === 0) {
      return {
        accountId,
        totalRecords: 0,
        oldestRecord: '',
        newestRecord: '',
        insights: [],
        overallSuccessRate: 0,
      };
    }

    // Sort by timestamp
    const sorted = [...records].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Group by actionType
    const grouped = new Map<OptimizationActionType, OptimizationRecord[]>();
    for (const record of records) {
      const group = grouped.get(record.actionType);
      if (group) {
        group.push(record);
      } else {
        grouped.set(record.actionType, [record]);
      }
    }

    // Build insights
    const insights: AccountInsight[] = [];
    let totalPositive = 0;
    let totalWithOutcome = 0;

    for (const [actionType, group] of grouped) {
      const positiveRecords = group.filter((r) => r.outcome?.status === 'positive');
      const negativeRecords = group.filter((r) => r.outcome?.status === 'negative');
      const neutralRecords = group.filter((r) => r.outcome?.status === 'neutral');
      const pendingRecords = group.filter(
        (r) => !r.outcome || r.outcome.status === 'pending',
      );

      const withOutcome = positiveRecords.length + negativeRecords.length + neutralRecords.length;
      const successRate = withOutcome > 0 ? positiveRecords.length / withOutcome : 0;

      totalPositive += positiveRecords.length;
      totalWithOutcome += withOutcome;

      // Average impact for positive and negative outcomes
      const avgPositiveImpact =
        positiveRecords.length > 0
          ? positiveRecords.reduce(
              (sum, r) => sum + Math.abs(r.outcome!.primaryMetricDeltaPercent),
              0,
            ) / positiveRecords.length
          : 0;

      const avgNegativeImpact =
        negativeRecords.length > 0
          ? negativeRecords.reduce(
              (sum, r) => sum + Math.abs(r.outcome!.primaryMetricDeltaPercent),
              0,
            ) / negativeRecords.length
          : 0;

      // Find best performing parameters — the parameters from the record with
      // the best outcome (most positive primaryMetricDeltaPercent)
      let bestParameters: Record<string, unknown> | undefined;
      if (positiveRecords.length > 0) {
        const best = positiveRecords.reduce((a, b) =>
          Math.abs(a.outcome!.primaryMetricDeltaPercent) >
          Math.abs(b.outcome!.primaryMetricDeltaPercent)
            ? a
            : b,
        );
        bestParameters = best.parameters;
      }

      // Generate recommendation
      let recommendation: string;
      if (withOutcome === 0) {
        recommendation = 'No completed outcomes yet — continue monitoring';
      } else if (successRate > 0.7) {
        recommendation = 'Continue this strategy — historically effective';
      } else if (successRate >= 0.4) {
        recommendation = 'Mixed results — use with caution and monitor closely';
      } else {
        recommendation = 'Historically underperforming — consider alternative approaches';
      }

      insights.push({
        actionType,
        totalAttempts: group.length,
        positiveOutcomes: positiveRecords.length,
        negativeOutcomes: negativeRecords.length,
        neutralOutcomes: neutralRecords.length,
        pendingOutcomes: pendingRecords.length,
        successRate: Math.round(successRate * 1000) / 1000,
        avgPositiveImpact: Math.round(avgPositiveImpact * 10) / 10,
        avgNegativeImpact: Math.round(avgNegativeImpact * 10) / 10,
        bestParameters,
        recommendation,
      });
    }

    const overallSuccessRate =
      totalWithOutcome > 0 ? totalPositive / totalWithOutcome : 0;

    return {
      accountId,
      totalRecords: records.length,
      oldestRecord: sorted[0]!.timestamp,
      newestRecord: sorted[sorted.length - 1]!.timestamp,
      insights,
      overallSuccessRate: Math.round(overallSuccessRate * 1000) / 1000,
    };
  }

  // -------------------------------------------------------------------------
  // (d) getRecommendation
  // -------------------------------------------------------------------------

  getRecommendation(
    accountId: string,
    proposedAction: OptimizationActionType,
    entityId?: string,
  ): MemoryRecommendation {
    const records = this.records.get(accountId) ?? [];

    // Filter records for this action type
    const actionRecords = records.filter((r) => r.actionType === proposedAction);

    if (actionRecords.length === 0) {
      return {
        confidence: 'low',
        recommendation:
          'No historical data for this action type — proceed with standard monitoring',
        historicalSuccessRate: 0,
        recentTrend: 'stable',
      };
    }

    // Consider entity-specific history if entityId provided
    const entityRecords = entityId
      ? actionRecords.filter((r) => r.entityId === entityId)
      : [];

    // Compute overall success rate for this action type
    const withOutcome = actionRecords.filter(
      (r) => r.outcome && r.outcome.status !== 'pending',
    );
    const positive = withOutcome.filter((r) => r.outcome!.status === 'positive');
    const overallRate = withOutcome.length > 0 ? positive.length / withOutcome.length : 0;

    // Compute recent trend — compare last 5 outcomes vs overall
    const recentTrend = this.computeRecentTrend(withOutcome, overallRate);

    // Build recommendation
    let recommendation: string;
    let confidence: string;

    if (entityRecords.length > 0) {
      const entityWithOutcome = entityRecords.filter(
        (r) => r.outcome && r.outcome.status !== 'pending',
      );
      const entityPositive = entityWithOutcome.filter(
        (r) => r.outcome!.status === 'positive',
      );
      const entityRate =
        entityWithOutcome.length > 0
          ? entityPositive.length / entityWithOutcome.length
          : 0;

      if (entityRate > 0.7) {
        recommendation = `This action has worked well for entity ${entityId} (${(entityRate * 100).toFixed(0)}% success rate across ${entityWithOutcome.length} attempts) — recommended`;
        confidence = entityWithOutcome.length >= 5 ? 'high' : 'medium';
      } else if (entityRate >= 0.4) {
        recommendation = `Mixed results for entity ${entityId} (${(entityRate * 100).toFixed(0)}% success rate) — proceed with caution`;
        confidence = 'medium';
      } else if (entityWithOutcome.length > 0) {
        recommendation = `This action has underperformed for entity ${entityId} (${(entityRate * 100).toFixed(0)}% success rate) — consider alternatives`;
        confidence = entityWithOutcome.length >= 3 ? 'high' : 'medium';
      } else {
        recommendation = `No completed outcomes for entity ${entityId} yet; account-wide rate is ${(overallRate * 100).toFixed(0)}%`;
        confidence = 'low';
      }
    } else {
      if (overallRate > 0.7) {
        recommendation = `Historically effective for this account (${(overallRate * 100).toFixed(0)}% success rate across ${withOutcome.length} attempts) — recommended`;
        confidence = withOutcome.length >= 5 ? 'high' : 'medium';
      } else if (overallRate >= 0.4) {
        recommendation = `Mixed historical results (${(overallRate * 100).toFixed(0)}% success rate) — proceed with monitoring`;
        confidence = 'medium';
      } else if (withOutcome.length > 0) {
        recommendation = `Historically underperforming (${(overallRate * 100).toFixed(0)}% success rate) — consider alternative approaches`;
        confidence = withOutcome.length >= 3 ? 'high' : 'medium';
      } else {
        recommendation = 'All outcomes still pending — no recommendation yet';
        confidence = 'low';
      }
    }

    // Factor in recent trend
    if (recentTrend === 'improving') {
      recommendation += '. Recent trend is improving.';
    } else if (recentTrend === 'declining') {
      recommendation += '. Warning: recent trend is declining.';
    }

    return {
      confidence,
      recommendation,
      historicalSuccessRate: Math.round(overallRate * 1000) / 1000,
      recentTrend,
    };
  }

  private computeRecentTrend(
    withOutcome: OptimizationRecord[],
    overallRate: number,
  ): 'improving' | 'declining' | 'stable' {
    if (withOutcome.length < 5) {
      return 'stable';
    }

    // Sort by timestamp descending, take last 5
    const sorted = [...withOutcome].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const recent = sorted.slice(0, 5);
    const recentPositive = recent.filter((r) => r.outcome!.status === 'positive').length;
    const recentRate = recentPositive / recent.length;

    if (recentRate > overallRate + 0.15) {
      return 'improving';
    } else if (recentRate < overallRate - 0.15) {
      return 'declining';
    }
    return 'stable';
  }

  // -------------------------------------------------------------------------
  // (e) listRecords
  // -------------------------------------------------------------------------

  listRecords(
    accountId: string,
    filter?: {
      actionType?: OptimizationActionType;
      entityId?: string;
      status?: OptimizationOutcome['status'];
      limit?: number;
    },
  ): OptimizationRecord[] {
    let records = this.records.get(accountId) ?? [];

    if (filter?.actionType) {
      records = records.filter((r) => r.actionType === filter.actionType);
    }
    if (filter?.entityId) {
      records = records.filter((r) => r.entityId === filter.entityId);
    }
    if (filter?.status) {
      if (filter.status === 'pending') {
        records = records.filter(
          (r) => !r.outcome || r.outcome.status === 'pending',
        );
      } else {
        records = records.filter((r) => r.outcome?.status === filter.status);
      }
    }

    // Sort by timestamp descending (newest first)
    records = [...records].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    if (filter?.limit && filter.limit > 0) {
      records = records.slice(0, filter.limit);
    }

    return records;
  }

  // -------------------------------------------------------------------------
  // (f) exportMemory
  // -------------------------------------------------------------------------

  exportMemory(accountId: string): string {
    const records = this.records.get(accountId) ?? [];
    return JSON.stringify({
      accountId,
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    });
  }

  // -------------------------------------------------------------------------
  // (g) importMemory
  // -------------------------------------------------------------------------

  importMemory(data: string): number {
    const parsed = JSON.parse(data) as {
      accountId: string;
      records: OptimizationRecord[];
    };

    if (!parsed.accountId || !Array.isArray(parsed.records)) {
      throw new Error('Invalid memory export format: expected { accountId, records }');
    }

    const existing = this.records.get(parsed.accountId) ?? [];
    const existingIds = new Set(existing.map((r) => r.id));

    let imported = 0;
    for (const record of parsed.records) {
      if (!existingIds.has(record.id)) {
        existing.push(record);
        existingIds.add(record.id);
        imported += 1;
      }
    }

    this.records.set(parsed.accountId, existing);
    return imported;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private findRecordById(recordId: string): OptimizationRecord | undefined {
    for (const records of this.records.values()) {
      const found = records.find((r) => r.id === recordId);
      if (found) return found;
    }
    return undefined;
  }
}
