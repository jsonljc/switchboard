// ---------------------------------------------------------------------------
// Headroom Scorer — Spend scaling potential assessment
// ---------------------------------------------------------------------------
// Wraps digital-ads headroom model 3.1 output into a 0-100 score.
// High headroom = high score (room to grow). Low headroom = saturation
// constraint is binding.
//
// Scoring:
//   60% headroom percentage (capped at 100% = full score)
//   25% model confidence (R² quality)
//   15% caveat severity
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

const HEADROOM_CRITICAL = 5; // <5% headroom = saturated
const HEADROOM_WARNING = 15; // <15% headroom = approaching saturation
const RSQUARED_LOW = 0.5; // R² below this = unreliable model

// ---------------------------------------------------------------------------
// scoreHeadroom
// ---------------------------------------------------------------------------

export function scoreHeadroom(data: NormalizedData): ScorerOutput {
  const now = new Date().toISOString();
  const issues: ScorerIssue[] = [];
  const breakdown: Record<string, number> = {};

  const headroom = data.headroom;

  if (!headroom) {
    return {
      scorerName: "headroom",
      score: 0,
      confidence: "LOW",
      issues: [
        {
          code: "NO_HEADROOM_DATA",
          severity: "critical",
          message:
            "No headroom analysis data available. Requires sufficient daily spend history for modeling.",
        },
      ],
      breakdown: {},
      computedAt: now,
    };
  }

  // --- Headroom Percentage Score (0-100) ---
  // Scale: 0% headroom = 0 score, 100%+ headroom = 100 score
  const headroomScore = Math.min(100, Math.max(0, Math.round(headroom.headroomPercent)));
  breakdown["headroomPercent"] = headroomScore;

  if (headroom.headroomPercent < HEADROOM_CRITICAL) {
    issues.push({
      code: "HEADROOM_SATURATED",
      severity: "critical",
      message: `Only ${headroom.headroomPercent.toFixed(1)}% headroom remaining. Account is near spend saturation.`,
      metric: "headroomPercent",
      currentValue: headroom.headroomPercent,
      threshold: HEADROOM_WARNING,
    });
  } else if (headroom.headroomPercent < HEADROOM_WARNING) {
    issues.push({
      code: "HEADROOM_LOW",
      severity: "warning",
      message: `${headroom.headroomPercent.toFixed(1)}% headroom remaining. Approaching diminishing returns.`,
      metric: "headroomPercent",
      currentValue: headroom.headroomPercent,
      threshold: HEADROOM_WARNING,
    });
  }

  // --- Model Confidence Score (0-100) ---
  const confidenceScore = Math.round(headroom.rSquared * 100);
  breakdown["modelConfidence"] = confidenceScore;

  if (headroom.rSquared < RSQUARED_LOW) {
    issues.push({
      code: "HEADROOM_LOW_CONFIDENCE",
      severity: "warning",
      message: `Model R² is ${headroom.rSquared.toFixed(2)}. Below ${RSQUARED_LOW} — results may be unreliable.`,
      metric: "rSquared",
      currentValue: headroom.rSquared,
      threshold: RSQUARED_LOW,
    });
  }

  // --- Caveat Score (0-100) ---
  const maxCaveats = 5;
  const caveatCount = headroom.caveats.length;
  const caveatScore = Math.max(0, Math.round((1 - caveatCount / maxCaveats) * 100));
  breakdown["caveats"] = caveatScore;

  if (caveatCount > 3) {
    issues.push({
      code: "HEADROOM_MANY_CAVEATS",
      severity: "warning",
      message: `Headroom model has ${caveatCount} caveats: ${headroom.caveats.slice(0, 2).join("; ")}`,
    });
  }

  // --- Composite Score ---
  const compositeScore = Math.round(
    headroomScore * 0.6 + confidenceScore * 0.25 + caveatScore * 0.15,
  );

  const confidence = mapConfidence(headroom.confidence);

  return {
    scorerName: "headroom",
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

function mapConfidence(tier: "HIGH" | "MEDIUM" | "LOW"): ConfidenceLevel {
  return tier;
}
