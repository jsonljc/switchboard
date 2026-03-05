// ---------------------------------------------------------------------------
// Journey Walker — Core Diagnostic Engine
// ---------------------------------------------------------------------------
// Walks the customer journey schema, compares two MetricsSnapshots, and
// produces a JourneyDiagnosticResult. Mirrors funnel-walker.ts from
// digital-ads.
// ---------------------------------------------------------------------------

import type {
  JourneySchema,
  ContactMetricsSnapshot,
  ComparisonPeriods,
  JourneyDiagnosticResult,
  JourneyDiagnosticContext,
  JourneyFinding,
  Severity,
} from "../types.js";
import type { JourneyFindingAdvisor } from "../../advisors/types.js";
import { compareStages } from "./stage-comparator.js";
import { analyzeDropoffs, findBottleneck } from "./bottleneck-detector.js";
import { percentChange } from "./significance.js";

export interface JourneyWalkerOptions {
  schema: JourneySchema;
  current: ContactMetricsSnapshot;
  previous: ContactMetricsSnapshot;
  periods: ComparisonPeriods;
  advisors?: JourneyFindingAdvisor[];
  context?: JourneyDiagnosticContext;
}

export function analyzeJourney(options: JourneyWalkerOptions): JourneyDiagnosticResult {
  const { schema, current, previous, periods, advisors, context } = options;

  // 1. Per-stage period-over-period analysis
  const stageAnalysis = compareStages(schema, current, previous);

  // 2. Drop-off rates between adjacent stages
  const dropoffs = analyzeDropoffs(schema, current, previous);

  // 3. Find the bottleneck
  const bottleneck = findBottleneck(stageAnalysis);

  // 4. Primary KPI summary
  const primaryMetric = schema.primaryKPI;
  const currentKPI = current.stages[primaryMetric]?.count ?? 0;
  const previousKPI = previous.stages[primaryMetric]?.count ?? 0;
  const kpiDelta = percentChange(currentKPI, previousKPI);

  const primaryKPI = {
    name: primaryMetric,
    current: currentKPI,
    previous: previousKPI,
    deltaPercent: kpiDelta,
    severity: classifyKPISeverity(kpiDelta, current.totalContacts),
  };

  // 5. Generate findings
  const findings: JourneyFinding[] = generateGenericFindings(
    stageAnalysis,
    dropoffs,
    bottleneck,
    primaryKPI,
  );

  // 6. Run advisors
  if (advisors) {
    for (const advisor of advisors) {
      findings.push(...advisor(stageAnalysis, dropoffs, current, previous, context));
    }
  }

  // Sort findings by severity
  const severityOrder: Record<Severity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    healthy: 3,
  };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    organizationId: current.organizationId,
    periods,
    totalContacts: { current: current.totalContacts, previous: previous.totalContacts },
    primaryKPI,
    stageAnalysis,
    dropoffs,
    bottleneck,
    findings,
  };
}

function classifyKPISeverity(deltaPercent: number, totalContacts: number): Severity {
  if (deltaPercent >= 0) return "healthy";

  const magnitude = Math.abs(deltaPercent);
  const volumeMultiplier = totalContacts > 500 ? 0.7 : totalContacts > 100 ? 0.85 : 1;

  if (magnitude > 30 * volumeMultiplier) return "critical";
  if (magnitude > 15 * volumeMultiplier) return "warning";
  if (magnitude > 5 * volumeMultiplier) return "info";
  return "healthy";
}

function generateGenericFindings(
  _stageAnalysis: import("../types.js").JourneyStageDiagnostic[],
  dropoffs: import("../types.js").JourneyDropoff[],
  bottleneck: import("../types.js").JourneyStageDiagnostic | null,
  primaryKPI: JourneyDiagnosticResult["primaryKPI"],
): JourneyFinding[] {
  const findings: JourneyFinding[] = [];

  // Primary KPI summary
  if (primaryKPI.current === 0 && primaryKPI.previous === 0) {
    findings.push({
      severity: "info",
      stage: primaryKPI.name,
      message: `No ${primaryKPI.name} recorded in either period.`,
      recommendation:
        "Verify data collection is configured correctly or that there is sufficient contact volume.",
    });
  } else if (primaryKPI.severity === "healthy") {
    findings.push({
      severity: "healthy",
      stage: primaryKPI.name,
      message: `${primaryKPI.name} is stable: ${primaryKPI.current} (${primaryKPI.deltaPercent > 0 ? "+" : ""}${primaryKPI.deltaPercent.toFixed(1)}% PoP).`,
      recommendation: null,
    });
  } else {
    findings.push({
      severity: primaryKPI.severity,
      stage: primaryKPI.name,
      message: `${primaryKPI.name} changed: ${primaryKPI.previous} → ${primaryKPI.current} (${primaryKPI.deltaPercent > 0 ? "+" : ""}${primaryKPI.deltaPercent.toFixed(1)}% PoP).`,
      recommendation: null,
    });
  }

  // Bottleneck finding
  if (bottleneck) {
    findings.push({
      severity: bottleneck.severity,
      stage: bottleneck.stageName,
      message: `Largest volume drop is at the ${bottleneck.stageName} stage: ${bottleneck.deltaPercent.toFixed(1)}% PoP (${bottleneck.previousValue} → ${bottleneck.currentValue}).`,
      recommendation: null,
    });
  }

  // Flag worsening drop-off rates
  for (const dropoff of dropoffs) {
    if (dropoff.deltaPercent < -20) {
      findings.push({
        severity: dropoff.deltaPercent < -40 ? "critical" : "warning",
        stage: `${dropoff.fromStage} → ${dropoff.toStage}`,
        message: `Conversion rate from ${dropoff.fromStage} to ${dropoff.toStage} dropped ${dropoff.deltaPercent.toFixed(1)}% (${(dropoff.previousRate * 100).toFixed(1)}% → ${(dropoff.currentRate * 100).toFixed(1)}%).`,
        recommendation: null,
      });
    }
  }

  return findings;
}
