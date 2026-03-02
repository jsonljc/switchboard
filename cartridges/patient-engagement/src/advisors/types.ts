// ---------------------------------------------------------------------------
// Journey Finding Advisor — Type Signature
// ---------------------------------------------------------------------------

import type {
  JourneyStageDiagnostic,
  JourneyDropoff,
  PatientMetricsSnapshot,
  JourneyFinding,
  JourneyDiagnosticContext,
} from "../core/types.js";

/**
 * A JourneyFindingAdvisor is a pure function that inspects journey diagnostics
 * and produces zero or more findings. Zero LLM dependency — all logic is
 * deterministic.
 *
 * Mirrors the FindingAdvisor signature from digital-ads.
 */
export type JourneyFindingAdvisor = (
  stageAnalysis: JourneyStageDiagnostic[],
  dropoffs: JourneyDropoff[],
  current: PatientMetricsSnapshot,
  previous: PatientMetricsSnapshot,
  context?: JourneyDiagnosticContext,
) => JourneyFinding[];
