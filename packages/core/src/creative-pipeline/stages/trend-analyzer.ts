// packages/core/src/creative-pipeline/stages/trend-analyzer.ts
import { callClaude } from "./call-claude.js";
import { TrendAnalysisOutput } from "@switchboard/schemas";

interface TrendBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  references?: string[];
}

export function buildTrendPrompt(brief: TrendBrief): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `You are an expert performance creative strategist who analyzes products, audiences, and platform trends to identify winning creative angles for paid advertising.

Your job is to analyze the provided brief and return a JSON object with exactly this structure:

{
  "angles": [
    {
      "theme": "A short creative theme name",
      "motivator": "The core audience motivator this angle taps into",
      "platformFit": "Which platform this angle works best on",
      "rationale": "Why this angle will work for this audience"
    }
  ],
  "audienceInsights": {
    "awarenessLevel": "problem_aware",  // one of: unaware, problem_aware, solution_aware, product_aware, most_aware
    "topDrivers": ["Top 3-5 purchase drivers"],
    "objections": ["Top 3-5 objections or hesitations"]
  },
  "trendSignals": [
    {
      "platform": "Platform name",
      "trend": "Current trend on this platform",
      "relevance": "How this trend connects to the product"
    }
  ]
}

Guidelines:
- Generate 3-5 creative angles, each tied to a different audience motivator
- Assess the audience's awareness level based on the product category
- Identify platform-specific trends that the creative can leverage
- Be specific and actionable — avoid generic advice
- Respond ONLY with the JSON object, no surrounding text`;

  let userMessage = `Analyze this brief and produce creative strategy output:

**Product:** ${brief.productDescription}

**Target Audience:** ${brief.targetAudience}

**Platforms:** ${brief.platforms.join(", ")}`;

  if (brief.references && brief.references.length > 0) {
    userMessage += `\n\n**References (competitor ads, trend links, inspiration):**\n${brief.references.map((r) => `- ${r}`).join("\n")}`;
  }

  return { systemPrompt, userMessage };
}

export async function runTrendAnalyzer(
  brief: TrendBrief,
  apiKey: string,
): Promise<TrendAnalysisOutput> {
  const { systemPrompt, userMessage } = buildTrendPrompt(brief);

  return callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: TrendAnalysisOutput,
  });
}
