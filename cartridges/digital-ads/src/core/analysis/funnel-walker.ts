import type {
  FunnelSchema,
  MetricSnapshot,
  ComparisonPeriods,
  DiagnosticResult,
  StageDiagnostic,
  FunnelDropoff,
  Finding,
  Severity,
  VerticalBenchmarks,
  DiagnosticContext,
} from "../types.js";
import { percentChange, isSignificantChange } from "./significance.js";
import {
  computeStageEconomicImpact,
  computeDropoffEconomicImpact,
  buildElasticityRanking,
} from "./economic-impact.js";
import { assessConversionLag } from "./conversion-lag.js";

// ---------------------------------------------------------------------------
// Generic Funnel Walker
// ---------------------------------------------------------------------------
// Walks any FunnelSchema, compares two MetricSnapshots, and produces a
// DiagnosticResult. This is vertical-agnostic — the schema defines the
// shape, and optional advisors can append vertical-specific findings.
// ---------------------------------------------------------------------------

export type FindingAdvisor = (
  stageAnalysis: StageDiagnostic[],
  dropoffs: FunnelDropoff[],
  current: MetricSnapshot,
  previous: MetricSnapshot,
  context?: DiagnosticContext
) => Finding[];

export interface FunnelWalkerOptions {
  funnel: FunnelSchema;
  current: MetricSnapshot;
  previous: MetricSnapshot;
  periods: ComparisonPeriods;
  benchmarks?: VerticalBenchmarks;
  /** Vertical-specific advisors that generate findings */
  advisors?: FindingAdvisor[];
  /** Diagnostic context for structural/historical analysis */
  context?: DiagnosticContext;
}

export function analyzeFunnel(options: FunnelWalkerOptions): DiagnosticResult {
  const { funnel, current, previous, periods, benchmarks, advisors, context } = options;

  // 1. Per-stage WoW analysis
  const stageAnalysis = analyzeStages(funnel, current, previous, benchmarks);

  // 2. Drop-off rates between adjacent stages
  const dropoffs = analyzeDropoffs(funnel, current, previous);

  // 3. Compute economic impact when revenue data is available
  let elasticity: DiagnosticResult["elasticity"];
  if (context?.revenueData) {
    const aov = context.revenueData.averageOrderValue;

    // Annotate stages with economic impact
    for (const stage of stageAnalysis) {
      const isBottomOfFunnel =
        stage.metric === funnel.primaryKPI ||
        stage.metric === funnel.stages[funnel.stages.length - 1]?.metric;
      stage.economicImpact = computeStageEconomicImpact(stage, aov, isBottomOfFunnel);
    }

    // Annotate dropoffs with economic impact
    // Use per-dropoff from-stage count as baseline, not a shared bottom-of-funnel count
    for (const dropoff of dropoffs) {
      const fromStageSchema = funnel.stages.find((s) => s.name === dropoff.fromStage);
      const expectedFromCount = fromStageSchema
        ? (previous.stages[fromStageSchema.metric]?.count ?? 0)
        : 0;
      dropoff.economicImpact = computeDropoffEconomicImpact(dropoff, expectedFromCount, aov);
    }

    // Build elasticity ranking
    elasticity = buildElasticityRanking(stageAnalysis);
  }

  // 4. Find the bottleneck — prefer economic impact ranking when available
  const bottleneck = findBottleneck(stageAnalysis, elasticity);

  // 5. Primary KPI summary
  const primaryStage = funnel.stages.find(
    (s) => s.metric === funnel.primaryKPI || s.costMetric === funnel.primaryKPI
  );
  const primaryMetric = funnel.primaryKPI;
  const currentCost = current.stages[primaryMetric]?.cost;
  const previousCost = previous.stages[primaryMetric]?.cost;
  // Use cost if available on either period; fall back to count-based comparison
  const hasCostData = currentCost !== null && currentCost !== undefined
    && previousCost !== null && previousCost !== undefined;
  const currentKPI = hasCostData ? currentCost : (current.stages[primaryMetric]?.count ?? 0);
  const previousKPI = hasCostData ? previousCost : (previous.stages[primaryMetric]?.count ?? 0);
  const kpiDelta = percentChange(currentKPI, previousKPI);

  const primaryKPI = {
    name: primaryStage?.name ?? primaryMetric,
    current: currentKPI,
    previous: previousKPI,
    deltaPercent: kpiDelta,
    severity: classifySeverity(kpiDelta, current.spend, hasCostData),
  };

  // 6. Generate findings — start with generic, then vertical-specific advisors
  const findings: Finding[] = generateGenericFindings(
    stageAnalysis,
    dropoffs,
    bottleneck,
    primaryKPI
  );

  // Conversion lag assessment
  const periodDays = Math.round(
    (new Date(periods.current.until).getTime() - new Date(periods.current.since).getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1;
  const lagAssessment = assessConversionLag(
    periods.current.until,
    periods.previous.until,
    new Date(),
    periodDays,
  );
  if (lagAssessment.lagIsSignificant) {
    findings.push({
      severity: "info",
      stage: "conversion_lag",
      message: `Conversion lag warning: current period is ${(lagAssessment.currentMaturity * 100).toFixed(0)}% mature vs ${(lagAssessment.previousMaturity * 100).toFixed(0)}% for previous. Reported drops may partially reflect attribution delay.`,
      recommendation: "Re-check in 2-3 days when current period data matures, or compare against a period that ended 4+ days ago.",
    });
  }

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
  findings.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  return {
    vertical: funnel.vertical,
    entityId: current.entityId,
    periods,
    spend: { current: current.spend, previous: previous.spend },
    primaryKPI,
    stageAnalysis,
    dropoffs,
    bottleneck,
    findings,
    elasticity,
  };
}

// ---------------------------------------------------------------------------
// Stage-level analysis
// ---------------------------------------------------------------------------

function analyzeStages(
  funnel: FunnelSchema,
  current: MetricSnapshot,
  previous: MetricSnapshot,
  benchmarks?: VerticalBenchmarks
): StageDiagnostic[] {
  return funnel.stages.map((stage) => {
    const currentMetrics = current.stages[stage.metric];
    const previousMetrics = previous.stages[stage.metric];

    const currentValue = currentMetrics?.count ?? 0;
    const previousValue = previousMetrics?.count ?? 0;
    const delta = currentValue - previousValue;
    const deltaPercent = percentChange(currentValue, previousValue);

    const benchmarkVariance =
      benchmarks?.benchmarks[stage.metric]?.normalVariancePercent;

    const significant = isSignificantChange(
      deltaPercent,
      current.spend,
      benchmarkVariance
    );

    return {
      stageName: stage.name,
      metric: stage.metric,
      currentValue,
      previousValue,
      delta,
      deltaPercent,
      isSignificant: significant,
      severity: classifySeverity(deltaPercent, current.spend, false),
    };
  });
}

// ---------------------------------------------------------------------------
// Drop-off analysis between adjacent funnel stages
// ---------------------------------------------------------------------------

function analyzeDropoffs(
  funnel: FunnelSchema,
  current: MetricSnapshot,
  previous: MetricSnapshot
): FunnelDropoff[] {
  const dropoffs: FunnelDropoff[] = [];

  for (let i = 0; i < funnel.stages.length - 1; i++) {
    const fromStage = funnel.stages[i]!;
    const toStage = funnel.stages[i + 1]!;

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

// ---------------------------------------------------------------------------
// Bottleneck detection
// ---------------------------------------------------------------------------

function findBottleneck(
  stageAnalysis: StageDiagnostic[],
  elasticity?: DiagnosticResult["elasticity"]
): StageDiagnostic | null {
  // When economic impact data is available, prefer the stage with the worst
  // revenue impact rather than the worst percentage drop
  if (elasticity && elasticity.impactRanking.length > 0) {
    const topImpactStage = elasticity.impactRanking[0]!.stage;
    const match = stageAnalysis.find((s) => s.stageName === topImpactStage);
    if (match && match.isSignificant && match.deltaPercent < 0) {
      return match;
    }
  }

  let worst: StageDiagnostic | null = null;

  for (const stage of stageAnalysis) {
    // Only consider significant negative changes (volume dropped)
    if (!stage.isSignificant || stage.deltaPercent >= 0) continue;

    if (worst === null || stage.deltaPercent < worst.deltaPercent) {
      worst = stage;
    }
  }

  return worst;
}

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

function classifySeverity(
  deltaPercent: number,
  spend: number,
  isCostMetric: boolean
): Severity {
  // For cost metrics (CPA, CPL), increases are bad
  // For volume metrics (clicks, purchases), decreases are bad
  const badDirection = isCostMetric ? deltaPercent > 0 : deltaPercent < 0;
  const magnitude = Math.abs(deltaPercent);

  if (!badDirection) return "healthy";

  // Adjust thresholds by spend — larger accounts get tighter thresholds
  const spendMultiplier = spend > 5000 ? 0.7 : spend > 1000 ? 0.85 : 1;

  if (magnitude > 30 * spendMultiplier) return "critical";
  if (magnitude > 15 * spendMultiplier) return "warning";
  if (magnitude > 5 * spendMultiplier) return "info";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Generic findings — not vertical-specific
// ---------------------------------------------------------------------------

function generateGenericFindings(
  stageAnalysis: StageDiagnostic[],
  dropoffs: FunnelDropoff[],
  bottleneck: StageDiagnostic | null,
  primaryKPI: DiagnosticResult["primaryKPI"]
): Finding[] {
  const findings: Finding[] = [];

  // Primary KPI summary
  const kpiFormatted = primaryKPI.current > 0 && primaryKPI.previous > 0;
  if (primaryKPI.current === 0 && primaryKPI.previous === 0) {
    findings.push({
      severity: "info",
      stage: primaryKPI.name,
      message: `No ${primaryKPI.name} conversions recorded in either period.`,
      recommendation: "Verify tracking is configured correctly or that the campaign has sufficient spend to generate conversions.",
    });
  } else if (primaryKPI.severity === "healthy") {
    findings.push({
      severity: "healthy",
      stage: primaryKPI.name,
      message: kpiFormatted
        ? `${primaryKPI.name} is stable at $${primaryKPI.current.toFixed(2)} (${primaryKPI.deltaPercent > 0 ? "+" : ""}${primaryKPI.deltaPercent.toFixed(1)}% WoW).`
        : `${primaryKPI.name} is stable (${primaryKPI.deltaPercent > 0 ? "+" : ""}${primaryKPI.deltaPercent.toFixed(1)}% WoW).`,
      recommendation: null,
    });
  } else {
    findings.push({
      severity: primaryKPI.severity,
      stage: primaryKPI.name,
      message: kpiFormatted
        ? `${primaryKPI.name} cost changed to $${primaryKPI.current.toFixed(2)} (${primaryKPI.deltaPercent > 0 ? "+" : ""}${primaryKPI.deltaPercent.toFixed(1)}% WoW).`
        : `${primaryKPI.name} changed: ${primaryKPI.previous} → ${primaryKPI.current} (${primaryKPI.deltaPercent > 0 ? "+" : ""}${primaryKPI.deltaPercent.toFixed(1)}% WoW).`,
      recommendation: null,
    });
  }

  // Bottleneck finding
  if (bottleneck) {
    findings.push({
      severity: bottleneck.severity,
      stage: bottleneck.stageName,
      message: `Largest volume drop is at the ${bottleneck.stageName} stage: ${bottleneck.deltaPercent.toFixed(1)}% WoW (${bottleneck.previousValue} → ${bottleneck.currentValue}).`,
      recommendation: null,
    });
  }

  // Flag any drop-off rate that worsened significantly
  for (const dropoff of dropoffs) {
    if (dropoff.deltaPercent < -20) {
      findings.push({
        severity: dropoff.deltaPercent < -40 ? "critical" : "warning",
        stage: `${dropoff.fromStage} → ${dropoff.toStage}`,
        message: `Conversion rate from ${dropoff.fromStage} to ${dropoff.toStage} dropped ${dropoff.deltaPercent.toFixed(1)}% (${(dropoff.previousRate * 100).toFixed(2)}% → ${(dropoff.currentRate * 100).toFixed(2)}%).`,
        recommendation: null,
      });
    }
  }

  // Spend change
  const spendStage = stageAnalysis.find((s) => s.metric === "impressions");
  if (spendStage && Math.abs(spendStage.deltaPercent) > 20) {
    findings.push({
      severity: "info",
      stage: "awareness",
      message: `Impression volume shifted ${spendStage.deltaPercent > 0 ? "+" : ""}${spendStage.deltaPercent.toFixed(1)}% WoW. Large volume swings affect all downstream metrics.`,
      recommendation: null,
    });
  }

  return findings;
}
