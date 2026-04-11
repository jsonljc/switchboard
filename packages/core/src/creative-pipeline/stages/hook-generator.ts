// packages/core/src/creative-pipeline/stages/hook-generator.ts
import { callClaude } from "./call-claude.js";
import { HookGeneratorOutput } from "@switchboard/schemas";
import type { TrendAnalysisOutput } from "@switchboard/schemas";

interface HookBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
}

export function buildHookPrompt(
  brief: HookBrief,
  trendOutput: TrendAnalysisOutput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are an expert performance ad hook copywriter. You generate scroll-stopping hooks for paid social ads.

Your job is to take creative angles from a trend analysis and generate 3 hook variants per angle, scored against platform-specific rules.

## Platform Rules

- **Meta cold (prospecting):** Pattern interrupt — stop the scroll. Bold claims, surprising stats, or visual disruption.
- **Meta retargeting:** Social proof — testimonials, case studies, "Join X others who..."
- **YouTube skippable:** Problem or question in first 2 seconds. No logo in first 2s. Hook must earn the watch.
- **YouTube Shorts:** Native UGC feel. Raw, authentic, first-person.
- **TikTok:** Curiosity + native feel. "I can't believe...", "POV:", trending audio hooks.

## Hook Types

- "pattern_interrupt" — Visual or verbal disruption that stops scrolling
- "question" — Opens a loop the viewer needs closed
- "bold_statement" — Controversial or surprising claim

## Output Format

Return a JSON object with exactly this structure:

{
  "hooks": [
    {
      "angleRef": "Index of the angle from the trend analysis (0-based string)",
      "text": "The hook text (first 1-3 seconds of the ad)",
      "type": "question",  // one of: pattern_interrupt, question, bold_statement
      "platformScore": 8,  // integer 1-10
      "rationale": "Why this hook works for the target platform"
    }
  ],
  "topCombos": [
    {
      "angleRef": "Index of the angle",
      "hookRef": "Index of the hook in the hooks array (0-based string)",
      "score": 8  // integer 1-10
    }
  ]
}

Guidelines:
- Generate 3 hooks per angle (one of each type when possible)
- Score each hook 1-10 for its target platform fit
- topCombos should rank the top 3-5 best angle+hook combinations
- Be specific to the product — no generic hooks
- Respond ONLY with the JSON object`;

  const userMessage = `Generate hooks based on this trend analysis:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
**Platforms:** ${brief.platforms.join(", ")}

**Creative Angles from Stage 1:**
${trendOutput.angles.map((a, i) => `${i}. Theme: "${a.theme}" | Motivator: "${a.motivator}" | Platform Fit: ${a.platformFit} | Rationale: ${a.rationale}`).join("\n")}

**Audience Insights:**
- Awareness Level: ${trendOutput.audienceInsights.awarenessLevel}
- Top Drivers: ${trendOutput.audienceInsights.topDrivers.join(", ")}
- Objections: ${trendOutput.audienceInsights.objections.join(", ")}

**Trend Signals:**
${trendOutput.trendSignals.map((t) => `- ${t.platform}: ${t.trend} (${t.relevance})`).join("\n")}`;

  return { systemPrompt, userMessage };
}

export async function runHookGenerator(
  brief: HookBrief,
  trendOutput: TrendAnalysisOutput,
  apiKey: string,
): Promise<HookGeneratorOutput> {
  const { systemPrompt, userMessage } = buildHookPrompt(brief, trendOutput);

  return callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: HookGeneratorOutput,
  });
}
