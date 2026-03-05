// ---------------------------------------------------------------------------
// Bottleneck Detector — Drop-off identification between journey stages
// ---------------------------------------------------------------------------

import type {
  JourneySchema,
  ContactMetricsSnapshot,
  JourneyDropoff,
  JourneyStageDiagnostic,
} from "../types.js";
import { percentChange } from "./significance.js";

/**
 * Analyze drop-off rates between adjacent non-terminal journey stages.
 */
export function analyzeDropoffs(
  schema: JourneySchema,
  current: ContactMetricsSnapshot,
  previous: ContactMetricsSnapshot,
): JourneyDropoff[] {
  const dropoffs: JourneyDropoff[] = [];
  const nonTerminal = schema.stages.filter((s) => !s.terminal);

  for (let i = 0; i < nonTerminal.length - 1; i++) {
    const fromStage = nonTerminal[i]!;
    const toStage = nonTerminal[i + 1]!;

    const currentFrom = current.stages[fromStage.metric]?.count ?? 0;
    const currentTo = current.stages[toStage.metric]?.count ?? 0;
    const previousFrom = previous.stages[fromStage.metric]?.count ?? 0;
    const previousTo = previous.stages[toStage.metric]?.count ?? 0;

    const currentRate = currentFrom > 0 ? currentTo / currentFrom : 0;
    const previousRate = previousFrom > 0 ? previousTo / previousFrom : 0;

    dropoffs.push({
      fromStage: fromStage.name,
      toStage: toStage.name,
      currentRate,
      previousRate,
      deltaPercent: percentChange(currentRate, previousRate),
    });
  }

  return dropoffs;
}

/**
 * Find the stage with the worst significant negative change.
 */
export function findBottleneck(
  stageAnalysis: JourneyStageDiagnostic[],
): JourneyStageDiagnostic | null {
  let worst: JourneyStageDiagnostic | null = null;

  for (const stage of stageAnalysis) {
    if (!stage.isSignificant || stage.deltaPercent >= 0) continue;
    if (worst === null || stage.deltaPercent < worst.deltaPercent) {
      worst = stage;
    }
  }

  return worst;
}
