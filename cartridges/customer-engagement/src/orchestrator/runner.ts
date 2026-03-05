// ---------------------------------------------------------------------------
// Multi-stage Diagnostic Runner
// ---------------------------------------------------------------------------

import type {
  JourneyDiagnosticResult,
  ContactMetricsSnapshot,
  ComparisonPeriods,
  BusinessType,
} from "../core/types.js";
import { CUSTOMER_JOURNEY_SCHEMA } from "../core/types.js";
import { analyzeJourney } from "../core/analysis/journey-walker.js";
import { resolveAdvisors } from "../advisors/registry.js";

export interface DiagnosticRunConfig {
  organizationId: string;
  businessType: BusinessType;
  current: ContactMetricsSnapshot;
  previous: ContactMetricsSnapshot;
  periods: ComparisonPeriods;
}

/**
 * Run a full multi-stage pipeline diagnostic.
 */
export function runDiagnostic(config: DiagnosticRunConfig): JourneyDiagnosticResult {
  const advisors = resolveAdvisors(config.businessType);

  return analyzeJourney({
    schema: CUSTOMER_JOURNEY_SCHEMA,
    current: config.current,
    previous: config.previous,
    periods: config.periods,
    advisors,
    context: { businessType: config.businessType },
  });
}
