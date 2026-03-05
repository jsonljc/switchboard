// ---------------------------------------------------------------------------
// Stage Comparator — Period-over-period stage analysis
// ---------------------------------------------------------------------------

import type {
  JourneySchema,
  ContactMetricsSnapshot,
  JourneyStageDiagnostic,
  Severity,
  JourneyStageId,
} from "../types.js";
import { percentChange, isSignificantChange } from "./significance.js";

/**
 * Compare current vs previous period for each journey stage.
 */
export function compareStages(
  schema: JourneySchema,
  current: ContactMetricsSnapshot,
  previous: ContactMetricsSnapshot,
): JourneyStageDiagnostic[] {
  return schema.stages
    .filter((stage) => !stage.terminal)
    .map((stage) => {
      const currentMetrics = current.stages[stage.metric];
      const previousMetrics = previous.stages[stage.metric];

      const currentValue = currentMetrics?.count ?? 0;
      const previousValue = previousMetrics?.count ?? 0;
      const delta = currentValue - previousValue;
      const deltaPercent = percentChange(currentValue, previousValue);

      const significant = isSignificantChange(deltaPercent, current.totalContacts);

      return {
        stageName: stage.name,
        stageId: stage.id as JourneyStageId,
        metric: stage.metric,
        currentValue,
        previousValue,
        delta,
        deltaPercent,
        isSignificant: significant,
        severity: classifyStageSeverity(deltaPercent, current.totalContacts),
      };
    });
}

function classifyStageSeverity(deltaPercent: number, totalContacts: number): Severity {
  // For volume metrics, decreases are bad
  if (deltaPercent >= 0) return "healthy";

  const magnitude = Math.abs(deltaPercent);
  const volumeMultiplier = totalContacts > 500 ? 0.7 : totalContacts > 100 ? 0.85 : 1;

  if (magnitude > 30 * volumeMultiplier) return "critical";
  if (magnitude > 15 * volumeMultiplier) return "warning";
  if (magnitude > 5 * volumeMultiplier) return "info";
  return "healthy";
}
