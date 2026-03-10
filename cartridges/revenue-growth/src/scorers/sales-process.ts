// ---------------------------------------------------------------------------
// Sales Process Scorer — CRM pipeline velocity and attribution
// ---------------------------------------------------------------------------
// Evaluates the sales process by scoring:
//   30% lead-to-close conversion rate
//   25% follow-up velocity (time to first contact)
//   25% CRM match rate (ad → CRM attribution linkage)
//   20% pipeline stage conversion consistency
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

const LEAD_TO_CLOSE_CRITICAL = 0.02;
const LEAD_TO_CLOSE_WARNING = 0.05;
const FOLLOWUP_CRITICAL_HOURS = 48;
const FOLLOWUP_WARNING_HOURS = 24;
const MATCH_RATE_CRITICAL = 0.2;
const MATCH_RATE_WARNING = 0.5;
const FOLLOWUP_24H_CRITICAL = 0.3;
const FOLLOWUP_24H_WARNING = 0.6;

// ---------------------------------------------------------------------------
// scoreSalesProcess
// ---------------------------------------------------------------------------

export function scoreSalesProcess(data: NormalizedData): ScorerOutput {
  const now = new Date().toISOString();
  const issues: ScorerIssue[] = [];
  const breakdown: Record<string, number> = {};

  const crm = data.crmSummary;

  if (!crm) {
    return {
      scorerName: "sales-process",
      score: 0,
      confidence: "LOW",
      issues: [
        {
          code: "NO_CRM_DATA",
          severity: "critical",
          message: "No CRM data available. Connect a CRM to enable sales process analysis.",
        },
      ],
      breakdown: {},
      computedAt: now,
    };
  }

  // --- Lead-to-Close Conversion (0-100) ---
  let conversionScore = 50;
  if (crm.leadToCloseRate !== null) {
    // Scale: 0% = 0, 10%+ = 100
    conversionScore = Math.min(100, Math.round(crm.leadToCloseRate * 1000));

    if (crm.leadToCloseRate < LEAD_TO_CLOSE_CRITICAL) {
      issues.push({
        code: "LEAD_TO_CLOSE_CRITICAL",
        severity: "critical",
        message: `Lead-to-close rate is ${(crm.leadToCloseRate * 100).toFixed(1)}%. Below ${LEAD_TO_CLOSE_CRITICAL * 100}% indicates a broken sales process.`,
        metric: "leadToCloseRate",
        currentValue: crm.leadToCloseRate,
        threshold: LEAD_TO_CLOSE_WARNING,
      });
    } else if (crm.leadToCloseRate < LEAD_TO_CLOSE_WARNING) {
      issues.push({
        code: "LEAD_TO_CLOSE_WARNING",
        severity: "warning",
        message: `Lead-to-close rate is ${(crm.leadToCloseRate * 100).toFixed(1)}%. Below industry average.`,
        metric: "leadToCloseRate",
        currentValue: crm.leadToCloseRate,
        threshold: LEAD_TO_CLOSE_WARNING,
      });
    }
  }
  breakdown["leadToClose"] = conversionScore;

  // --- Follow-up Velocity (0-100, inverted: faster = higher score) ---
  let velocityScore = 50;
  if (crm.averageTimeToFirstContact !== null) {
    const hours = crm.averageTimeToFirstContact;

    if (hours >= FOLLOWUP_CRITICAL_HOURS) {
      velocityScore = 0;
      issues.push({
        code: "FOLLOWUP_VELOCITY_CRITICAL",
        severity: "critical",
        message: `Average time to first contact is ${hours.toFixed(0)}h. Leads go cold after 24h.`,
        metric: "averageTimeToFirstContact",
        currentValue: hours,
        threshold: FOLLOWUP_WARNING_HOURS,
      });
    } else if (hours >= FOLLOWUP_WARNING_HOURS) {
      velocityScore = Math.round(
        ((FOLLOWUP_CRITICAL_HOURS - hours) / (FOLLOWUP_CRITICAL_HOURS - FOLLOWUP_WARNING_HOURS)) *
          50,
      );
      issues.push({
        code: "FOLLOWUP_VELOCITY_WARNING",
        severity: "warning",
        message: `Average time to first contact is ${hours.toFixed(0)}h. Aim for under ${FOLLOWUP_WARNING_HOURS}h.`,
        metric: "averageTimeToFirstContact",
        currentValue: hours,
        threshold: FOLLOWUP_WARNING_HOURS,
      });
    } else {
      velocityScore = Math.round(
        50 + ((FOLLOWUP_WARNING_HOURS - hours) / FOLLOWUP_WARNING_HOURS) * 50,
      );
    }
  }

  // Also check the 24h follow-up rate if available
  if (crm.followUpWithin24hRate !== null) {
    const rate24h = crm.followUpWithin24hRate;
    if (rate24h < FOLLOWUP_24H_CRITICAL) {
      issues.push({
        code: "FOLLOWUP_24H_CRITICAL",
        severity: "critical",
        message: `Only ${Math.round(rate24h * 100)}% of leads get follow-up within 24h.`,
        metric: "followUpWithin24hRate",
        currentValue: rate24h,
        threshold: FOLLOWUP_24H_WARNING,
      });
      // Blend into velocity score
      velocityScore = Math.round(velocityScore * 0.5 + rate24h * 100 * 0.5);
    } else if (rate24h < FOLLOWUP_24H_WARNING) {
      issues.push({
        code: "FOLLOWUP_24H_WARNING",
        severity: "warning",
        message: `${Math.round(rate24h * 100)}% of leads get follow-up within 24h. Target 60%+.`,
        metric: "followUpWithin24hRate",
        currentValue: rate24h,
        threshold: FOLLOWUP_24H_WARNING,
      });
    }
  }
  breakdown["followupVelocity"] = velocityScore;

  // --- CRM Match Rate / Attribution (0-100) ---
  const matchScore = Math.round(crm.matchRate * 100);
  breakdown["matchRate"] = matchScore;

  if (crm.matchRate < MATCH_RATE_CRITICAL) {
    issues.push({
      code: "CRM_ATTRIBUTION_CRITICAL",
      severity: "critical",
      message: `CRM match rate is ${Math.round(crm.matchRate * 100)}%. Most ad leads cannot be attributed to CRM outcomes.`,
      metric: "matchRate",
      currentValue: crm.matchRate,
      threshold: MATCH_RATE_WARNING,
    });
  } else if (crm.matchRate < MATCH_RATE_WARNING) {
    issues.push({
      code: "CRM_ATTRIBUTION_WARNING",
      severity: "warning",
      message: `CRM match rate is ${Math.round(crm.matchRate * 100)}%. Improve attribution for better optimization.`,
      metric: "matchRate",
      currentValue: crm.matchRate,
      threshold: MATCH_RATE_WARNING,
    });
  }

  // --- Pipeline Stage Consistency (0-100) ---
  let pipelineScore = 50;
  if (crm.stageConversionRates) {
    const rates = Object.values(crm.stageConversionRates);
    if (rates.length > 0) {
      const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
      // Scale: 0% avg = 0, 50%+ avg = 100
      pipelineScore = Math.min(100, Math.round(avgRate * 200));

      // Check for bottleneck stages
      for (const [stage, rate] of Object.entries(crm.stageConversionRates)) {
        if (rate < 0.1) {
          issues.push({
            code: "PIPELINE_STAGE_BOTTLENECK",
            severity: "warning",
            message: `Stage "${stage}" has only ${Math.round(rate * 100)}% conversion — potential bottleneck.`,
            metric: `stageConversion.${stage}`,
            currentValue: rate,
            threshold: 0.2,
          });
        }
      }
    }
  }
  breakdown["pipelineConsistency"] = pipelineScore;

  // --- Composite Score ---
  const compositeScore = Math.round(
    conversionScore * 0.3 + velocityScore * 0.25 + matchScore * 0.25 + pipelineScore * 0.2,
  );

  const confidence = determineConfidence(data);

  return {
    scorerName: "sales-process",
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
