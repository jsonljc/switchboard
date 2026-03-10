// ---------------------------------------------------------------------------
// Signal Health Scorer — Composite signal quality assessment
// ---------------------------------------------------------------------------
// Wraps digital-ads signal-health outputs (pixel, CAPI, EMQ, learning phase,
// delivery) into a single 0-100 score with weighted composite scoring:
//   40% event completeness
//   30% tracking coverage (pixel + CAPI)
//   20% CRM match rate
//   10% conversion lag
// ---------------------------------------------------------------------------

import type {
  ScorerOutput,
  ScorerIssue,
  NormalizedData,
  ConfidenceLevel,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const WEIGHT_EVENT_COMPLETENESS = 0.4;
const WEIGHT_TRACKING_COVERAGE = 0.3;
const WEIGHT_CRM_MATCH = 0.2;
const WEIGHT_CONVERSION_LAG = 0.1;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const THRESHOLD_EVENT_COMPLETENESS_CRITICAL = 0.3;
const THRESHOLD_EVENT_COMPLETENESS_WARNING = 0.7;
const THRESHOLD_EMQ_CRITICAL = 3;
const THRESHOLD_EMQ_WARNING = 6;
const THRESHOLD_CRM_MATCH_CRITICAL = 0.2;
const THRESHOLD_CRM_MATCH_WARNING = 0.5;
const THRESHOLD_LAG_CRITICAL_HOURS = 48;
const THRESHOLD_LAG_WARNING_HOURS = 24;

// ---------------------------------------------------------------------------
// scoreSignalHealth
// ---------------------------------------------------------------------------

export function scoreSignalHealth(data: NormalizedData): ScorerOutput {
  const now = new Date().toISOString();
  const issues: ScorerIssue[] = [];
  const breakdown: Record<string, number> = {};

  const signal = data.signalHealth;
  const crm = data.crmSummary;

  // If no signal data at all, return a sparse-confidence low score
  if (!signal) {
    return {
      scorerName: "signal-health",
      score: 0,
      confidence: "LOW",
      issues: [
        {
          code: "NO_SIGNAL_DATA",
          severity: "critical",
          message:
            "No signal health data available. Connect a platform to enable tracking diagnostics.",
        },
      ],
      breakdown: {},
      computedAt: now,
    };
  }

  // --- Event Completeness (0-100) ---
  const eventCompleteness = signal.eventCompleteness;
  const eventScore = Math.round(eventCompleteness * 100);
  breakdown["eventCompleteness"] = eventScore;

  if (eventCompleteness < THRESHOLD_EVENT_COMPLETENESS_CRITICAL) {
    issues.push({
      code: "EVENT_COMPLETENESS_CRITICAL",
      severity: "critical",
      message: `Event completeness is ${Math.round(eventCompleteness * 100)}%, well below the 70% target.`,
      metric: "eventCompleteness",
      currentValue: eventCompleteness,
      threshold: THRESHOLD_EVENT_COMPLETENESS_WARNING,
    });
  } else if (eventCompleteness < THRESHOLD_EVENT_COMPLETENESS_WARNING) {
    issues.push({
      code: "EVENT_COMPLETENESS_WARNING",
      severity: "warning",
      message: `Event completeness is ${Math.round(eventCompleteness * 100)}%. Aim for 70%+.`,
      metric: "eventCompleteness",
      currentValue: eventCompleteness,
      threshold: THRESHOLD_EVENT_COMPLETENESS_WARNING,
    });
  }

  // --- Tracking Coverage (0-100) ---
  let trackingScore = 0;
  if (signal.pixelActive && signal.capiConfigured) {
    trackingScore = 100;
  } else if (signal.pixelActive || signal.capiConfigured) {
    trackingScore = 50;
    issues.push({
      code: "PARTIAL_TRACKING",
      severity: "warning",
      message: signal.pixelActive
        ? "Pixel is active but CAPI is not configured. Server-side events improve match quality."
        : "CAPI is configured but pixel is inactive. Browser-side tracking is missing.",
    });
  } else {
    trackingScore = 0;
    issues.push({
      code: "NO_TRACKING",
      severity: "critical",
      message: "Neither pixel nor CAPI is active. No conversion tracking is in place.",
    });
  }

  // Factor in EMQ if available
  if (signal.eventMatchQuality !== null) {
    const emqNormalized = Math.round((signal.eventMatchQuality / 10) * 100);
    trackingScore = Math.round((trackingScore + emqNormalized) / 2);

    if (signal.eventMatchQuality < THRESHOLD_EMQ_CRITICAL) {
      issues.push({
        code: "EMQ_CRITICAL",
        severity: "critical",
        message: `Event Match Quality is ${signal.eventMatchQuality}/10. Below 3 severely impacts optimization.`,
        metric: "eventMatchQuality",
        currentValue: signal.eventMatchQuality,
        threshold: THRESHOLD_EMQ_WARNING,
      });
    } else if (signal.eventMatchQuality < THRESHOLD_EMQ_WARNING) {
      issues.push({
        code: "EMQ_WARNING",
        severity: "warning",
        message: `Event Match Quality is ${signal.eventMatchQuality}/10. Target 6+ for optimal matching.`,
        metric: "eventMatchQuality",
        currentValue: signal.eventMatchQuality,
        threshold: THRESHOLD_EMQ_WARNING,
      });
    }
  }

  breakdown["trackingCoverage"] = trackingScore;

  // --- CRM Match Rate (0-100) ---
  let crmMatchScore = 50; // default when no CRM data
  if (crm) {
    crmMatchScore = Math.round(crm.matchRate * 100);

    if (crm.matchRate < THRESHOLD_CRM_MATCH_CRITICAL) {
      issues.push({
        code: "CRM_MATCH_CRITICAL",
        severity: "critical",
        message: `CRM match rate is ${Math.round(crm.matchRate * 100)}%. Most ad leads are not matched to CRM records.`,
        metric: "crmMatchRate",
        currentValue: crm.matchRate,
        threshold: THRESHOLD_CRM_MATCH_WARNING,
      });
    } else if (crm.matchRate < THRESHOLD_CRM_MATCH_WARNING) {
      issues.push({
        code: "CRM_MATCH_WARNING",
        severity: "warning",
        message: `CRM match rate is ${Math.round(crm.matchRate * 100)}%. Aim for 50%+ for reliable attribution.`,
        metric: "crmMatchRate",
        currentValue: crm.matchRate,
        threshold: THRESHOLD_CRM_MATCH_WARNING,
      });
    }
  }
  breakdown["crmMatch"] = crmMatchScore;

  // --- Conversion Lag (0-100, inverted: lower lag = higher score) ---
  let lagScore = 100; // default when no lag data
  if (signal.conversionLagHours !== null) {
    if (signal.conversionLagHours >= THRESHOLD_LAG_CRITICAL_HOURS) {
      lagScore = 0;
      issues.push({
        code: "CONVERSION_LAG_CRITICAL",
        severity: "critical",
        message: `Conversion lag is ${signal.conversionLagHours}h. Data is severely delayed.`,
        metric: "conversionLagHours",
        currentValue: signal.conversionLagHours,
        threshold: THRESHOLD_LAG_WARNING_HOURS,
      });
    } else if (signal.conversionLagHours >= THRESHOLD_LAG_WARNING_HOURS) {
      lagScore = Math.round(
        ((THRESHOLD_LAG_CRITICAL_HOURS - signal.conversionLagHours) /
          (THRESHOLD_LAG_CRITICAL_HOURS - THRESHOLD_LAG_WARNING_HOURS)) *
          50,
      );
      issues.push({
        code: "CONVERSION_LAG_WARNING",
        severity: "warning",
        message: `Conversion lag is ${signal.conversionLagHours}h. Optimization may be delayed.`,
        metric: "conversionLagHours",
        currentValue: signal.conversionLagHours,
        threshold: THRESHOLD_LAG_WARNING_HOURS,
      });
    } else {
      lagScore = Math.round(
        50 +
          ((THRESHOLD_LAG_WARNING_HOURS - signal.conversionLagHours) /
            THRESHOLD_LAG_WARNING_HOURS) *
            50,
      );
    }
  }
  breakdown["conversionLag"] = lagScore;

  // --- Composite Score ---
  const compositeScore = Math.round(
    eventScore * WEIGHT_EVENT_COMPLETENESS +
      trackingScore * WEIGHT_TRACKING_COVERAGE +
      crmMatchScore * WEIGHT_CRM_MATCH +
      lagScore * WEIGHT_CONVERSION_LAG,
  );

  // --- Confidence ---
  const confidence = determineConfidence(data);

  return {
    scorerName: "signal-health",
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
