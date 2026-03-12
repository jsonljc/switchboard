// ---------------------------------------------------------------------------
// Post-Change Monitor — Anomaly detection after intervention execution
// ---------------------------------------------------------------------------
// Checks interventions at predefined checkpoints (4h, 24h, 72h) after
// entering EXECUTING status. Detects anomalies (>20% metric drops) and
// recommends PAUSE when significant degradation is found.
// ---------------------------------------------------------------------------

import type { Intervention, MonitorCheckpoint, NormalizedData } from "@switchboard/schemas";
import type { MonitorCheckpointStore } from "../stores/interfaces.js";
import type { RevGrowthDeps } from "../data/normalizer.js";
import { collectNormalizedData } from "../data/normalizer.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Checkpoint hours after EXECUTING status */
const CHECKPOINT_HOURS = [4, 24, 72];

/** Anomaly threshold — >20% drop triggers a recommendation */
const ANOMALY_THRESHOLD_PCT = -20;

/** Which metrics to monitor per constraint type */
const MONITORED_METRICS: Record<
  string,
  (data: NormalizedData) => { name: string; value: number } | null
> = {
  SIGNAL: (data) =>
    data.signalHealth
      ? { name: "eventCompleteness", value: data.signalHealth.eventCompleteness * 100 }
      : null,
  CREATIVE: (data) =>
    data.creativeAssets
      ? { name: "averageScore", value: data.creativeAssets.averageScore ?? 0 }
      : null,
  FUNNEL: (data) => {
    if (data.funnelEvents.length === 0) return null;
    const avgRate =
      data.funnelEvents.reduce((sum, e) => sum + (e.conversionRate ?? 0), 0) /
      data.funnelEvents.length;
    return { name: "avgConversionRate", value: avgRate * 100 };
  },
  SALES: (data) =>
    data.crmSummary
      ? { name: "leadToCloseRate", value: (data.crmSummary.leadToCloseRate ?? 0) * 100 }
      : null,
  SATURATION: (data) => (data.adMetrics ? { name: "roas", value: data.adMetrics.roas ?? 0 } : null),
};

// ---------------------------------------------------------------------------
// PostChangeMonitor
// ---------------------------------------------------------------------------

export class PostChangeMonitor {
  /**
   * Check all executing interventions for due monitoring checkpoints.
   */
  async checkDueInterventions(
    deps: RevGrowthDeps & {
      monitorCheckpointStore?: MonitorCheckpointStore;
    },
    accountId: string,
    organizationId: string,
  ): Promise<MonitorCheckpoint[]> {
    if (!deps.interventionStore || !deps.monitorCheckpointStore) return [];

    // Find interventions in EXECUTING status with measurementStartedAt set
    const allInterventions = await deps.interventionStore.listByAccount(accountId, {
      status: "EXECUTING",
    });

    const executingInterventions = allInterventions.filter((i) => i.measurementStartedAt);

    const checkpoints: MonitorCheckpoint[] = [];

    for (const intervention of executingInterventions) {
      const dueCheckpoints = await this.getDueCheckpoints(
        intervention,
        deps.monitorCheckpointStore,
      );

      for (const hours of dueCheckpoints) {
        const checkpoint = await this.runCheckpoint(
          intervention,
          hours,
          deps,
          accountId,
          organizationId,
        );
        if (checkpoint) {
          await deps.monitorCheckpointStore.save(checkpoint);
          checkpoints.push(checkpoint);
        }
      }
    }

    return checkpoints;
  }

  /**
   * Determine which checkpoint hours are due but not yet completed.
   */
  private async getDueCheckpoints(
    intervention: Intervention,
    store: MonitorCheckpointStore,
  ): Promise<number[]> {
    if (!intervention.measurementStartedAt) return [];

    const startedAt = new Date(intervention.measurementStartedAt).getTime();
    const elapsedHours = (Date.now() - startedAt) / (1000 * 60 * 60);

    const completedCheckpoints = await store.listByIntervention(intervention.id);
    const completedHours = new Set(completedCheckpoints.map((c) => c.checkpointHours));

    return CHECKPOINT_HOURS.filter((hours) => elapsedHours >= hours && !completedHours.has(hours));
  }

  /**
   * Run a single monitoring checkpoint.
   */
  private async runCheckpoint(
    intervention: Intervention,
    checkpointHours: number,
    deps: RevGrowthDeps,
    accountId: string,
    organizationId: string,
  ): Promise<MonitorCheckpoint | null> {
    const metricFn = MONITORED_METRICS[intervention.constraintType];
    if (!metricFn) return null;

    const normalizedData = await collectNormalizedData(accountId, organizationId, deps);
    const metric = metricFn(normalizedData);
    if (!metric) return null;

    // Use the intervention's reasoning to extract the original score as baseline
    const baselineValue = this.extractBaselineFromReasoning(intervention);

    const deltaPercent =
      baselineValue > 0 ? ((metric.value - baselineValue) / baselineValue) * 100 : 0;

    const anomalyDetected = deltaPercent < ANOMALY_THRESHOLD_PCT;

    const recommendation = anomalyDetected
      ? `PAUSE recommended: ${metric.name} dropped ${Math.abs(deltaPercent).toFixed(1)}% (from ${baselineValue.toFixed(1)} to ${metric.value.toFixed(1)}) at ${checkpointHours}h checkpoint`
      : null;

    return {
      id: crypto.randomUUID(),
      interventionId: intervention.id,
      accountId,
      checkpointHours,
      checkedAt: new Date().toISOString(),
      metricName: metric.name,
      metricValue: metric.value,
      baselineValue,
      deltaPercent,
      anomalyDetected,
      recommendation,
    };
  }

  /**
   * Extract baseline score from intervention reasoning (fallback).
   */
  private extractBaselineFromReasoning(intervention: Intervention): number {
    const match = intervention.reasoning.match(/score (\d+)\//);
    if (match) return Number(match[1]);
    return 50; // safe default
  }
}
