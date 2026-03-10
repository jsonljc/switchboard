// ---------------------------------------------------------------------------
// Funnel Leakage Scorer — Stage-by-stage conversion analysis
// ---------------------------------------------------------------------------
// Evaluates funnel health by analyzing drop-off rates between stages,
// comparing against benchmarks, and identifying the leakiest stage.
//
// Scoring weights:
//   40% worst stage drop-off severity
//   30% overall funnel conversion rate
//   20% stage-over-stage consistency
//   10% data completeness (number of stages tracked)
// ---------------------------------------------------------------------------

import type {
  ScorerOutput,
  ScorerIssue,
  NormalizedData,
  ConfidenceLevel,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Drop-off rate above which a stage is considered leaking */
const DROPOFF_CRITICAL = 0.7;
const DROPOFF_WARNING = 0.5;

/** Minimum stages for meaningful funnel analysis */
const MIN_FUNNEL_STAGES = 3;

// ---------------------------------------------------------------------------
// scoreFunnelLeakage
// ---------------------------------------------------------------------------

export function scoreFunnelLeakage(data: NormalizedData): ScorerOutput {
  const now = new Date().toISOString();
  const issues: ScorerIssue[] = [];
  const breakdown: Record<string, number> = {};

  const events = data.funnelEvents;

  // No funnel data
  if (events.length === 0) {
    return {
      scorerName: "funnel-leakage",
      score: 0,
      confidence: "LOW",
      issues: [
        {
          code: "NO_FUNNEL_DATA",
          severity: "critical",
          message: "No funnel event data available. Connect analytics to enable funnel analysis.",
        },
      ],
      breakdown: {},
      computedAt: now,
    };
  }

  // --- Data Completeness (0-100) ---
  const completenessScore =
    events.length >= MIN_FUNNEL_STAGES
      ? 100
      : Math.round((events.length / MIN_FUNNEL_STAGES) * 100);
  breakdown["completeness"] = completenessScore;

  if (events.length < MIN_FUNNEL_STAGES) {
    issues.push({
      code: "INSUFFICIENT_FUNNEL_STAGES",
      severity: "warning",
      message: `Only ${events.length} funnel stages tracked. Minimum ${MIN_FUNNEL_STAGES} recommended for full analysis.`,
      metric: "funnelStages",
      currentValue: events.length,
      threshold: MIN_FUNNEL_STAGES,
    });
  }

  // --- Calculate drop-off rates between adjacent stages ---
  const dropoffRates: Array<{ from: string; to: string; rate: number }> = [];

  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i]!;
    const next = events[i + 1]!;

    if (current.count > 0) {
      const dropoff = 1 - next.count / current.count;
      dropoffRates.push({
        from: current.stageName,
        to: next.stageName,
        rate: Math.max(0, dropoff),
      });
    }
  }

  // --- Worst Drop-off Score (0-100, inverted: lower drop-off = higher score) ---
  let worstDropoffScore = 100;
  if (dropoffRates.length > 0) {
    const worstDropoff = Math.max(...dropoffRates.map((d) => d.rate));
    const worstStage = dropoffRates.find((d) => d.rate === worstDropoff);

    if (worstDropoff >= DROPOFF_CRITICAL) {
      worstDropoffScore = Math.round((1 - worstDropoff) * 30);
      issues.push({
        code: "FUNNEL_STAGE_CRITICAL_DROPOFF",
        severity: "critical",
        message: `${Math.round(worstDropoff * 100)}% drop-off from ${worstStage?.from ?? "unknown"} to ${worstStage?.to ?? "unknown"}. This stage is losing most visitors.`,
        metric: "dropoffRate",
        currentValue: worstDropoff,
        threshold: DROPOFF_WARNING,
      });
    } else if (worstDropoff >= DROPOFF_WARNING) {
      worstDropoffScore = Math.round(30 + (1 - worstDropoff) * 70);
      issues.push({
        code: "FUNNEL_STAGE_HIGH_DROPOFF",
        severity: "warning",
        message: `${Math.round(worstDropoff * 100)}% drop-off from ${worstStage?.from ?? "unknown"} to ${worstStage?.to ?? "unknown"}.`,
        metric: "dropoffRate",
        currentValue: worstDropoff,
        threshold: DROPOFF_WARNING,
      });
    } else {
      worstDropoffScore = Math.round(70 + (1 - worstDropoff) * 30);
    }
  }
  breakdown["worstDropoff"] = worstDropoffScore;

  // --- Overall Conversion Rate (0-100) ---
  let overallScore = 50; // default
  if (events.length >= 2) {
    const topOfFunnel = events[0]!.count;
    const bottomOfFunnel = events[events.length - 1]!.count;

    if (topOfFunnel > 0) {
      const overallRate = bottomOfFunnel / topOfFunnel;
      // Scale: 0% = 0 score, 10%+ = 100 score (for typical commerce funnels)
      overallScore = Math.min(100, Math.round(overallRate * 1000));
      breakdown["overallConversion"] = overallScore;

      if (overallRate < 0.01) {
        issues.push({
          code: "FUNNEL_LOW_OVERALL_CONVERSION",
          severity: "critical",
          message: `Overall funnel conversion is ${(overallRate * 100).toFixed(2)}%. Less than 1% of top-of-funnel converts.`,
          metric: "overallConversionRate",
          currentValue: overallRate,
          threshold: 0.02,
        });
      } else if (overallRate < 0.03) {
        issues.push({
          code: "FUNNEL_BELOW_AVERAGE_CONVERSION",
          severity: "warning",
          message: `Overall funnel conversion is ${(overallRate * 100).toFixed(1)}%. Below typical benchmarks.`,
          metric: "overallConversionRate",
          currentValue: overallRate,
          threshold: 0.03,
        });
      }
    }
  }

  // --- Stage Consistency (0-100) ---
  let consistencyScore = 100;
  if (dropoffRates.length >= 2) {
    const rates = dropoffRates.map((d) => d.rate);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    // High CV means inconsistent — one stage is much worse than others
    consistencyScore = Math.max(0, Math.round((1 - Math.min(cv, 2) / 2) * 100));
  }
  breakdown["consistency"] = consistencyScore;

  // --- WoW Changes ---
  for (const event of events) {
    if (event.previousCount !== null && event.previousCount > 0) {
      const change = (event.count - event.previousCount) / event.previousCount;
      if (change < -0.3) {
        issues.push({
          code: "FUNNEL_STAGE_DECLINING",
          severity: "warning",
          message: `${event.stageName} dropped ${Math.round(Math.abs(change) * 100)}% week-over-week.`,
          metric: `${event.stageName}.wowChange`,
          currentValue: change,
          threshold: -0.3,
        });
      }
    }
  }

  // --- Composite Score ---
  const compositeScore = Math.round(
    worstDropoffScore * 0.4 + overallScore * 0.3 + consistencyScore * 0.2 + completenessScore * 0.1,
  );

  const confidence = determineConfidence(data);

  return {
    scorerName: "funnel-leakage",
    score: Math.max(0, Math.min(100, compositeScore)),
    confidence,
    issues,
    breakdown,
    computedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function determineConfidence(data: NormalizedData): ConfidenceLevel {
  if (data.dataTier === "FULL") return "HIGH";
  if (data.dataTier === "PARTIAL") return "MEDIUM";
  return "LOW";
}
