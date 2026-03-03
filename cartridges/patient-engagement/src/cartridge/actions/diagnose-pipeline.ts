// ---------------------------------------------------------------------------
// Action: patient-engagement.pipeline.diagnose
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  PatientMetricsSnapshot,
  ComparisonPeriods,
  ClinicType,
  JourneyDiagnosticContext,
} from "../../core/types.js";
import { PATIENT_JOURNEY_SCHEMA } from "../../core/types.js";
import { analyzeJourney } from "../../core/analysis/journey-walker.js";
import { resolveAdvisors } from "../../advisors/registry.js";

export async function executeDiagnosePipeline(
  params: Record<string, unknown>,
  currentSnapshot: PatientMetricsSnapshot,
  previousSnapshot: PatientMetricsSnapshot,
): Promise<ExecuteResult> {
  const start = Date.now();
  const organizationId = params.organizationId as string;
  const clinicType = (params.clinicType as ClinicType) ?? "general";

  const periods: ComparisonPeriods = {
    current: (params.currentPeriod as ComparisonPeriods["current"]) ?? {
      since: currentSnapshot.periodStart,
      until: currentSnapshot.periodEnd,
    },
    previous: (params.previousPeriod as ComparisonPeriods["previous"]) ?? {
      since: previousSnapshot.periodStart,
      until: previousSnapshot.periodEnd,
    },
  };

  const context: JourneyDiagnosticContext = { clinicType };
  const advisors = resolveAdvisors(clinicType);

  const result = analyzeJourney({
    schema: PATIENT_JOURNEY_SCHEMA,
    current: currentSnapshot,
    previous: previousSnapshot,
    periods,
    advisors,
    context,
  });

  return {
    success: true,
    summary: `Pipeline diagnosis complete for org ${organizationId}: ${result.findings.length} findings, bottleneck at ${result.bottleneck?.stageName ?? "none"}`,
    externalRefs: { organizationId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: result,
  };
}
