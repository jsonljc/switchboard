// ---------------------------------------------------------------------------
// Creative Strategy Generator — LLM + template-based strategy creation
// ---------------------------------------------------------------------------
// Given a creative gap analysis result and optional context, produces a
// creative strategy with prioritized recommendations, suggested formats,
// and test hypotheses.
// ---------------------------------------------------------------------------

import type { CreativeGapResult, AccountLearningProfile } from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Types (local to cartridge — not in schemas)
// ---------------------------------------------------------------------------

export interface CreativeStrategy {
  headline: string;
  prioritizedGaps: string[];
  recommendations: CreativeRecommendation[];
  testHypotheses: string[];
  generatedAt: string;
}

export interface CreativeRecommendation {
  gap: string;
  action: string;
  priority: "high" | "medium" | "low";
  expectedImpact: string;
}

export interface StrategyContext {
  accountProfile?: AccountLearningProfile | null;
  llmClient?: LLMClient | null;
}

// ---------------------------------------------------------------------------
// generateCreativeStrategy — Main entry point
// ---------------------------------------------------------------------------

export async function generateCreativeStrategy(
  gapResult: CreativeGapResult,
  context?: StrategyContext,
): Promise<CreativeStrategy> {
  if (context?.llmClient) {
    try {
      return await generateWithLLM(gapResult, context.llmClient, context.accountProfile);
    } catch {
      // Fall back to template
    }
  }

  return generateFromTemplate(gapResult, context?.accountProfile);
}

// ---------------------------------------------------------------------------
// Template-based generation (deterministic fallback)
// ---------------------------------------------------------------------------

const GAP_ACTIONS: Record<string, { action: string; expectedImpact: string }> = {
  FORMAT_DIVERSITY: {
    action: "Introduce 2-3 new creative formats (e.g., carousel, UGC-style video, collection ads)",
    expectedImpact: "Broader audience reach and reduced format fatigue",
  },
  HOOK_VARIETY: {
    action: "Test 3+ new opening hooks (question, statistic, testimonial, problem-solution)",
    expectedImpact: "Improved thumb-stop rate and ad recall",
  },
  CTA_COVERAGE: {
    action: "Audit and refresh CTAs — test urgency, benefit-led, and social proof variants",
    expectedImpact: "Higher click-through rate on existing creative",
  },
  AUDIENCE_MATCH: {
    action: "Create audience-specific creative variants tailored to top segments",
    expectedImpact: "Improved relevance scores and lower CPAs",
  },
  PLATFORM_FIT: {
    action: "Adapt creative to platform-native formats (9:16 for Reels, square for Feed)",
    expectedImpact: "Better engagement rates and algorithm favorability",
  },
  RECENCY: {
    action: "Launch fresh creative batch — retire assets with >30% fatigue",
    expectedImpact: "Reset audience fatigue and restore performance levels",
  },
  PERFORMANCE_SPREAD: {
    action: "Analyze and replicate top-performer patterns; pause bottom 30%",
    expectedImpact: "Portfolio-level ROAS improvement of 10-20%",
  },
};

function generateFromTemplate(
  gapResult: CreativeGapResult,
  profile?: AccountLearningProfile | null,
): CreativeStrategy {
  const prioritizedGaps = gapResult.significantGaps.sort((a, b) => {
    const criterionA = gapResult.criteria.find((c) => c.name === a);
    const criterionB = gapResult.criteria.find((c) => c.name === b);
    return (criterionA?.score ?? 100) - (criterionB?.score ?? 100);
  });

  const recommendations: CreativeRecommendation[] = prioritizedGaps.map((gap, idx) => {
    const template = GAP_ACTIONS[gap];
    return {
      gap,
      action: template?.action ?? `Address ${gap} gap`,
      priority: idx === 0 ? "high" : idx < 3 ? "medium" : "low",
      expectedImpact: template?.expectedImpact ?? "Performance improvement expected",
    };
  });

  const testHypotheses = buildTestHypotheses(prioritizedGaps, profile);

  const headline =
    prioritizedGaps.length > 0
      ? `${prioritizedGaps.length} creative gap(s) identified — focus on ${prioritizedGaps[0]}`
      : "Creative portfolio is healthy — maintain current approach";

  return {
    headline,
    prioritizedGaps,
    recommendations,
    testHypotheses,
    generatedAt: new Date().toISOString(),
  };
}

function buildTestHypotheses(gaps: string[], profile?: AccountLearningProfile | null): string[] {
  const hypotheses: string[] = [];

  if (gaps.includes("RECENCY")) {
    hypotheses.push("H1: Launching 5+ fresh assets will reduce CPA by 15% within 14 days");
  }

  if (gaps.includes("FORMAT_DIVERSITY")) {
    hypotheses.push("H2: Adding video format will increase engagement rate by 20%");
  }

  if (gaps.includes("AUDIENCE_MATCH")) {
    hypotheses.push("H3: Audience-specific creative variants will improve ROAS by 10%");
  }

  if (gaps.includes("HOOK_VARIETY")) {
    hypotheses.push("H4: Testing 3 new hook types will improve thumb-stop rate by 25%");
  }

  // Add profile-informed hypothesis
  if (profile && profile.creativePatterns.length > 0) {
    const topPattern = profile.creativePatterns.reduce((best, p) =>
      p.performanceScore > best.performanceScore ? p : best,
    );
    hypotheses.push(
      `H${hypotheses.length + 1}: Doubling down on "${topPattern.format}" format (score: ${topPattern.performanceScore}) will amplify top-performer effect`,
    );
  }

  if (hypotheses.length === 0) {
    hypotheses.push(
      "H1: Current creative portfolio is performing well — run maintenance tests only",
    );
  }

  return hypotheses;
}

// ---------------------------------------------------------------------------
// LLM-based generation
// ---------------------------------------------------------------------------

async function generateWithLLM(
  gapResult: CreativeGapResult,
  llmClient: LLMClient,
  profile?: AccountLearningProfile | null,
): Promise<CreativeStrategy> {
  const gapSummary = gapResult.criteria
    .map(
      (c) =>
        `${c.name}: score ${c.score}/100 (weight ${(c.weight * 100).toFixed(0)}%) — ${c.findings.join("; ")}`,
    )
    .join("\n");

  const profileContext = profile
    ? `\nAccount patterns: ${profile.creativePatterns.map((p) => `${p.format} (score: ${p.performanceScore})`).join(", ")}`
    : "";

  const response = await llmClient.complete([
    {
      role: "system",
      content:
        "You are a creative strategy advisor. Given creative gap analysis data, generate a JSON object with: headline (string), prioritizedGaps (string[]), recommendations (array of {gap, action, priority, expectedImpact}), and testHypotheses (string[]). Be specific and actionable.",
    },
    {
      role: "user",
      content: `Creative Gap Analysis (overall score: ${gapResult.overallScore}/100):\n${gapSummary}${profileContext}\n\nGenerate a creative strategy as JSON.`,
    },
  ]);

  try {
    const parsed = JSON.parse(response) as CreativeStrategy;
    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    // If LLM response isn't valid JSON, fall back to template
    return generateFromTemplate(gapResult, profile);
  }
}
