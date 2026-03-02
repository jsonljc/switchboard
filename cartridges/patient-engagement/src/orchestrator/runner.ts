// ---------------------------------------------------------------------------
// Multi-stage Diagnostic Runner
// ---------------------------------------------------------------------------

import type { JourneyDiagnosticResult, PatientMetricsSnapshot, ComparisonPeriods, ClinicType } from "../core/types.js";
import { PATIENT_JOURNEY_SCHEMA } from "../core/types.js";
import { analyzeJourney } from "../core/analysis/journey-walker.js";
import { resolveAdvisors } from "../advisors/registry.js";

export interface DiagnosticRunConfig {
  organizationId: string;
  clinicType: ClinicType;
  current: PatientMetricsSnapshot;
  previous: PatientMetricsSnapshot;
  periods: ComparisonPeriods;
}

/**
 * Run a full multi-stage pipeline diagnostic.
 */
export function runDiagnostic(config: DiagnosticRunConfig): JourneyDiagnosticResult {
  const advisors = resolveAdvisors(config.clinicType);

  return analyzeJourney({
    schema: PATIENT_JOURNEY_SCHEMA,
    current: config.current,
    previous: config.previous,
    periods: config.periods,
    advisors,
    context: { clinicType: config.clinicType },
  });
}
