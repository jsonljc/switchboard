// ---------------------------------------------------------------------------
// Creative Depth Scorer — Volume, variety, and performance assessment
// ---------------------------------------------------------------------------
// Wraps digital-ads CreativeAssetScorer output into a single 0-100 score
// assessing creative portfolio health:
//   40% portfolio diversity (variety of active concepts)
//   30% performance quality (average asset scores)
//   20% fatigue rate (% of assets showing fatigue signals)
//   10% volume adequacy (enough active assets)
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

const WEIGHT_DIVERSITY = 0.4;
const WEIGHT_QUALITY = 0.3;
const WEIGHT_FATIGUE = 0.2;
const WEIGHT_VOLUME = 0.1;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const MIN_ACTIVE_ASSETS = 3;
const MIN_ACTIVE_ASSETS_GOOD = 6;
const FATIGUE_RATE_CRITICAL = 0.5;
const FATIGUE_RATE_WARNING = 0.3;
const DIVERSITY_SCORE_CRITICAL = 30;
const DIVERSITY_SCORE_WARNING = 50;
const QUALITY_SCORE_WARNING = 40;
const QUALITY_SCORE_CRITICAL = 25;

// ---------------------------------------------------------------------------
// scoreCreativeDepth
// ---------------------------------------------------------------------------

export function scoreCreativeDepth(data: NormalizedData): ScorerOutput {
  const now = new Date().toISOString();
  const issues: ScorerIssue[] = [];
  const breakdown: Record<string, number> = {};

  const creative = data.creativeAssets;

  // If no creative data, return sparse-confidence low score
  if (!creative) {
    return {
      scorerName: "creative-depth",
      score: 0,
      confidence: "LOW",
      issues: [
        {
          code: "NO_CREATIVE_DATA",
          severity: "critical",
          message:
            "No creative asset data available. Connect an ad platform to enable creative analysis.",
        },
      ],
      breakdown: {},
      computedAt: now,
    };
  }

  // --- Volume Adequacy (0-100) ---
  let volumeScore: number;
  if (creative.activeAssets >= MIN_ACTIVE_ASSETS_GOOD) {
    volumeScore = 100;
  } else if (creative.activeAssets >= MIN_ACTIVE_ASSETS) {
    volumeScore = Math.round(
      ((creative.activeAssets - MIN_ACTIVE_ASSETS) / (MIN_ACTIVE_ASSETS_GOOD - MIN_ACTIVE_ASSETS)) *
        50 +
        50,
    );
  } else if (creative.activeAssets > 0) {
    volumeScore = Math.round((creative.activeAssets / MIN_ACTIVE_ASSETS) * 50);
    issues.push({
      code: "LOW_CREATIVE_VOLUME",
      severity: "warning",
      message: `Only ${creative.activeAssets} active creative assets. Minimum recommended is ${MIN_ACTIVE_ASSETS}.`,
      metric: "activeAssets",
      currentValue: creative.activeAssets,
      threshold: MIN_ACTIVE_ASSETS,
    });
  } else {
    volumeScore = 0;
    issues.push({
      code: "NO_ACTIVE_CREATIVES",
      severity: "critical",
      message: "No active creative assets found. Ads cannot run without creatives.",
      metric: "activeAssets",
      currentValue: 0,
      threshold: MIN_ACTIVE_ASSETS,
    });
  }
  breakdown["volume"] = volumeScore;

  // --- Diversity Score (0-100) ---
  const diversityScore = creative.diversityScore ?? 0;
  breakdown["diversity"] = diversityScore;

  if (diversityScore < DIVERSITY_SCORE_CRITICAL) {
    issues.push({
      code: "CREATIVE_DIVERSITY_CRITICAL",
      severity: "critical",
      message: `Creative diversity score is ${diversityScore}/100. Portfolio lacks variety — audiences see repetitive ads.`,
      metric: "diversityScore",
      currentValue: diversityScore,
      threshold: DIVERSITY_SCORE_WARNING,
    });
  } else if (diversityScore < DIVERSITY_SCORE_WARNING) {
    issues.push({
      code: "CREATIVE_DIVERSITY_WARNING",
      severity: "warning",
      message: `Creative diversity score is ${diversityScore}/100. Consider adding varied creative concepts.`,
      metric: "diversityScore",
      currentValue: diversityScore,
      threshold: DIVERSITY_SCORE_WARNING,
    });
  }

  // --- Quality Score (0-100) ---
  const qualityScore = creative.averageScore ?? 0;
  breakdown["quality"] = qualityScore;

  if (qualityScore < QUALITY_SCORE_CRITICAL) {
    issues.push({
      code: "CREATIVE_QUALITY_CRITICAL",
      severity: "critical",
      message: `Average creative quality score is ${qualityScore}/100. Most assets are underperforming.`,
      metric: "averageScore",
      currentValue: qualityScore,
      threshold: QUALITY_SCORE_WARNING,
    });
  } else if (qualityScore < QUALITY_SCORE_WARNING) {
    issues.push({
      code: "CREATIVE_QUALITY_WARNING",
      severity: "warning",
      message: `Average creative quality score is ${qualityScore}/100. Several assets need improvement.`,
      metric: "averageScore",
      currentValue: qualityScore,
      threshold: QUALITY_SCORE_WARNING,
    });
  }

  // --- Fatigue Rate (0-100, inverted: lower fatigue = higher score) ---
  let fatigueScore = 100;
  const fatigueRate = creative.fatigueRate ?? 0;

  if (fatigueRate >= FATIGUE_RATE_CRITICAL) {
    fatigueScore = 0;
    issues.push({
      code: "CREATIVE_FATIGUE_CRITICAL",
      severity: "critical",
      message: `${Math.round(fatigueRate * 100)}% of creatives show fatigue. Audiences are tuning out — refresh urgently.`,
      metric: "fatigueRate",
      currentValue: fatigueRate,
      threshold: FATIGUE_RATE_WARNING,
    });
  } else if (fatigueRate >= FATIGUE_RATE_WARNING) {
    fatigueScore = Math.round(
      ((FATIGUE_RATE_CRITICAL - fatigueRate) / (FATIGUE_RATE_CRITICAL - FATIGUE_RATE_WARNING)) * 50,
    );
    issues.push({
      code: "CREATIVE_FATIGUE_WARNING",
      severity: "warning",
      message: `${Math.round(fatigueRate * 100)}% of creatives show fatigue signals. Plan a refresh cycle.`,
      metric: "fatigueRate",
      currentValue: fatigueRate,
      threshold: FATIGUE_RATE_WARNING,
    });
  } else {
    fatigueScore = Math.round(
      50 + ((FATIGUE_RATE_WARNING - fatigueRate) / FATIGUE_RATE_WARNING) * 50,
    );
  }
  breakdown["fatigue"] = fatigueScore;

  // --- Composite Score ---
  const compositeScore = Math.round(
    diversityScore * WEIGHT_DIVERSITY +
      qualityScore * WEIGHT_QUALITY +
      fatigueScore * WEIGHT_FATIGUE +
      volumeScore * WEIGHT_VOLUME,
  );

  // --- Confidence ---
  const confidence = determineConfidence(data);

  return {
    scorerName: "creative-depth",
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
