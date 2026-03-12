// ---------------------------------------------------------------------------
// Creative Gap Analysis — Deterministic creative portfolio scoring
// ---------------------------------------------------------------------------
// Evaluates the creative portfolio across 7 weighted criteria to identify
// gaps and recommend areas for improvement. No LLM — fully deterministic.
//
// Criteria weights:
//   FORMAT_DIVERSITY (15%), HOOK_VARIETY (15%), CTA_COVERAGE (10%),
//   AUDIENCE_MATCH (15%), PLATFORM_FIT (10%), RECENCY (20%),
//   PERFORMANCE_SPREAD (15%)
// ---------------------------------------------------------------------------

import type {
  NormalizedData,
  AccountLearningProfile,
  CreativeGapCriterion,
  CreativeGapResult,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Criterion definitions
// ---------------------------------------------------------------------------

interface CriterionDef {
  name: string;
  weight: number;
  evaluate: (
    data: NormalizedData,
    profile?: AccountLearningProfile | null,
  ) => {
    score: number;
    findings: string[];
  };
}

const SIGNIFICANT_GAP_THRESHOLD = 50;

const CRITERIA: CriterionDef[] = [
  {
    name: "FORMAT_DIVERSITY",
    weight: 0.15,
    evaluate: (data) => {
      if (!data.creativeAssets) return { score: 0, findings: ["No creative data available"] };
      const diversity = data.creativeAssets.diversityScore ?? 0;
      const findings: string[] = [];
      if (diversity < 30)
        findings.push("Very low format diversity — portfolio relies on 1-2 formats");
      else if (diversity < 60)
        findings.push("Moderate format diversity — consider adding new formats");
      return { score: diversity, findings };
    },
  },
  {
    name: "HOOK_VARIETY",
    weight: 0.15,
    evaluate: (_data, profile) => {
      if (!profile || profile.creativePatterns.length === 0) {
        return { score: 50, findings: ["No hook pattern data available — using neutral score"] };
      }
      const hookPatterns = profile.creativePatterns.filter((p) => p.hookType);
      if (hookPatterns.length === 0) {
        return { score: 40, findings: ["No distinct hook types tracked"] };
      }
      // More hook types = higher score (capped at 100)
      const varietyScore = Math.min(100, hookPatterns.length * 25);
      const findings: string[] = [];
      if (hookPatterns.length < 3) findings.push("Limited hook variety — test new opening hooks");
      return { score: varietyScore, findings };
    },
  },
  {
    name: "CTA_COVERAGE",
    weight: 0.1,
    evaluate: (data) => {
      if (!data.creativeAssets) return { score: 0, findings: ["No creative data available"] };
      // Use active vs total ratio as proxy for CTA coverage
      const ratio =
        data.creativeAssets.totalAssets > 0
          ? (data.creativeAssets.activeAssets / data.creativeAssets.totalAssets) * 100
          : 0;
      const findings: string[] = [];
      if (ratio < 50) findings.push("Many inactive assets — review CTA effectiveness");
      return { score: Math.min(100, ratio), findings };
    },
  },
  {
    name: "AUDIENCE_MATCH",
    weight: 0.15,
    evaluate: (data) => {
      if (!data.adMetrics) return { score: 0, findings: ["No ad metrics available"] };
      // CTR as proxy for audience-creative match
      const ctrScore = Math.min(100, data.adMetrics.ctr * 2000); // 5% CTR = 100
      const findings: string[] = [];
      if (ctrScore < 40) findings.push("Low CTR indicates poor audience-creative match");
      return { score: ctrScore, findings };
    },
  },
  {
    name: "PLATFORM_FIT",
    weight: 0.1,
    evaluate: (data) => {
      if (!data.creativeAssets)
        return { score: 50, findings: ["Cannot assess platform fit without creative data"] };
      // Average score as proxy for platform fit
      const avgScore = data.creativeAssets.averageScore ?? 50;
      const findings: string[] = [];
      if (avgScore < 40)
        findings.push("Below-average creative performance suggests platform format mismatch");
      return { score: avgScore, findings };
    },
  },
  {
    name: "RECENCY",
    weight: 0.2,
    evaluate: (data) => {
      if (!data.creativeAssets) return { score: 0, findings: ["No creative data available"] };
      // Fatigue rate inversely correlates with recency
      const fatigueRate = data.creativeAssets.fatigueRate ?? 0;
      const recencyScore = Math.max(0, 100 - fatigueRate * 200); // 50% fatigue = 0
      const findings: string[] = [];
      if (fatigueRate > 0.3) findings.push("High creative fatigue — need fresh assets urgently");
      else if (fatigueRate > 0.15) findings.push("Moderate fatigue — plan creative refresh");
      return { score: recencyScore, findings };
    },
  },
  {
    name: "PERFORMANCE_SPREAD",
    weight: 0.15,
    evaluate: (data) => {
      if (!data.creativeAssets) return { score: 0, findings: ["No creative data available"] };
      const { topPerformerCount, bottomPerformerCount, activeAssets } = data.creativeAssets;
      if (activeAssets === 0) return { score: 0, findings: ["No active assets"] };

      // Good spread = many top performers, few bottom performers
      const topRatio = topPerformerCount / activeAssets;
      const bottomRatio = bottomPerformerCount / activeAssets;
      const spreadScore = Math.min(100, (topRatio * 100 + (1 - bottomRatio) * 100) / 2);

      const findings: string[] = [];
      if (bottomRatio > 0.3)
        findings.push("Too many underperforming assets — cull bottom performers");
      if (topRatio < 0.1)
        findings.push("Very few top performers — need more high-quality creative");
      return { score: spreadScore, findings };
    },
  },
];

// ---------------------------------------------------------------------------
// analyzeCreativeGaps — Main entry point
// ---------------------------------------------------------------------------

export function analyzeCreativeGaps(
  normalizedData: NormalizedData,
  accountProfile?: AccountLearningProfile | null,
): CreativeGapResult {
  const criteria: CreativeGapCriterion[] = CRITERIA.map((def) => {
    const { score, findings } = def.evaluate(normalizedData, accountProfile);
    return {
      name: def.name,
      score,
      weight: def.weight,
      weightedScore: score * def.weight,
      findings,
    };
  });

  const overallScore = criteria.reduce((sum, c) => sum + c.weightedScore, 0);

  const significantGaps = criteria
    .filter((c) => c.score < SIGNIFICANT_GAP_THRESHOLD)
    .map((c) => c.name);

  return {
    overallScore: Math.round(overallScore * 100) / 100,
    criteria,
    significantGaps,
    hasSignificantGaps: significantGaps.length > 0,
    analyzedAt: new Date().toISOString(),
  };
}
