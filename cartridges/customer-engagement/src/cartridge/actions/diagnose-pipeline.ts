// ---------------------------------------------------------------------------
// Action: customer-engagement.pipeline.diagnose
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type {
  ContactMetricsSnapshot,
  ComparisonPeriods,
  BusinessType,
  JourneyDiagnosticContext,
  JourneySchema,
} from "../../core/types.js";
import { CUSTOMER_JOURNEY_SCHEMA } from "../../core/types.js";
import { analyzeJourney } from "../../core/analysis/journey-walker.js";
import { resolveAdvisors } from "../../advisors/registry.js";

export async function executeDiagnosePipeline(
  params: Record<string, unknown>,
  currentSnapshot: ContactMetricsSnapshot,
  previousSnapshot: ContactMetricsSnapshot,
  journeySchema?: JourneySchema,
): Promise<ExecuteResult> {
  const start = Date.now();
  const organizationId = params.organizationId as string;
  const businessType = (params.businessType as BusinessType) ?? "general";
  const schema = journeySchema ?? CUSTOMER_JOURNEY_SCHEMA;

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

  const context: JourneyDiagnosticContext = { businessType };
  const advisors = resolveAdvisors(businessType);

  const result = analyzeJourney({
    schema,
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
