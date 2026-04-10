// packages/core/src/creative-pipeline/stages/script-writer.ts
import { callClaude } from "./call-claude.js";
import { ScriptWriterOutput } from "@switchboard/schemas";
import type { TrendAnalysisOutput, HookGeneratorOutput } from "@switchboard/schemas";

interface ScriptBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
}

export function buildScriptPrompt(
  brief: ScriptBrief,
  trendOutput: TrendAnalysisOutput,
  hookOutput: HookGeneratorOutput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are an expert performance ad scriptwriter. You write full ad scripts optimized for paid social platforms.

Your job is to take the top hook+angle combinations and write complete ad scripts with precise timing structure.

## Script Timing Structure (30-second format)

Every script follows this structure:
- **Hook** (0-3s): The opening hook that stops scrolling
- **Problem** (3-8s): Agitate the pain point
- **Solution** (8-18s): Present the product as the solution
- **Proof** (18-25s): Social proof, results, testimonials
- **CTA** (25-30s): Clear call to action

Adapt timing for different formats:
- **Stories/Shorts (15s):** Compress to Hook 0-2s, Problem 2-5s, Solution 5-10s, CTA 10-15s (skip proof)
- **YouTube skippable (60s):** Expand each section proportionally

## Ad Formats

- "feed_video" — Standard feed video (1:1 or 4:5), 15-30s
- "stories" — Full-screen vertical (9:16), 15s
- "skippable" — YouTube pre-roll, 15-60s
- "shorts" — YouTube Shorts / TikTok, 15-60s vertical

## Output Format

Return a JSON object with exactly this structure:

{
  "scripts": [
    {
      "hookRef": "Index of the hook used (0-based string)",
      "fullScript": "The complete script text with section markers",
      "timing": [
        { "section": "hook", "startSec": 0, "endSec": 3, "content": "Script content for this section" },
        { "section": "problem", "startSec": 3, "endSec": 8, "content": "..." },
        { "section": "solution", "startSec": 8, "endSec": 18, "content": "..." },
        { "section": "proof", "startSec": 18, "endSec": 25, "content": "..." },
        { "section": "cta", "startSec": 25, "endSec": 30, "content": "..." }
      ],
      "format": "feed_video" | "stories" | "skippable" | "shorts",
      "platform": "Platform name",
      "productionNotes": "Visual direction, filming style, or editing notes"
    }
  ]
}

Guidelines:
- Write 1 script per top combo (up to 5 scripts)
- Match format to platform (stories for Meta/TikTok, skippable for YouTube)
- Include specific production notes for each script
- Write in the brand's voice if provided, otherwise use a direct, benefit-focused tone
- Respond ONLY with the JSON object`;

  const topCombos = hookOutput.topCombos.slice(0, 5);

  const hookDetails = topCombos
    .map((combo) => {
      const hook = hookOutput.hooks[parseInt(combo.hookRef, 10)];
      const angle = trendOutput.angles[parseInt(combo.angleRef, 10)];
      return `- Hook "${hook?.text}" (type: ${hook?.type}) for angle "${angle?.theme}" | Score: ${combo.score}`;
    })
    .join("\n");

  let userMessage = `Write ad scripts for these top hook+angle combinations:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
**Platforms:** ${brief.platforms.join(", ")}`;

  if (brief.brandVoice) {
    userMessage += `\n**Brand Voice:** ${brief.brandVoice}`;
  }

  userMessage += `

**Audience Awareness:** ${trendOutput.audienceInsights.awarenessLevel}
**Key Drivers:** ${trendOutput.audienceInsights.topDrivers.join(", ")}
**Objections to Address:** ${trendOutput.audienceInsights.objections.join(", ")}

**Top Hook+Angle Combos (write one script each):**
${hookDetails}`;

  return { systemPrompt, userMessage };
}

export async function runScriptWriter(
  brief: ScriptBrief,
  trendOutput: TrendAnalysisOutput,
  hookOutput: HookGeneratorOutput,
  apiKey: string,
): Promise<ScriptWriterOutput> {
  const { systemPrompt, userMessage } = buildScriptPrompt(brief, trendOutput, hookOutput);

  return callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: ScriptWriterOutput,
    maxTokens: 8192, // Scripts are longer — need more output tokens
  });
}
