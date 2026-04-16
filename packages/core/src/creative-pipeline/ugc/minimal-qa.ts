// packages/core/src/creative-pipeline/ugc/minimal-qa.ts
// SP5 minimal QA: single Claude Vision pass returning pass/review/fail.
// SP6 replaces this with full hybrid realism scorer (face similarity, OCR, weighted soft scoring).

import { callClaude } from "../stages/call-claude.js";
import { z } from "zod";
import type { RealismScore } from "@switchboard/schemas";

// ── Types ──

export interface MinimalQaInput {
  videoUrl: string;
  specDescription: string;
  apiKey: string;
}

// ── Claude output schema ──

const MinimalQaOutputSchema = z.object({
  decision: z.enum(["pass", "review", "fail"]),
  reasoning: z.string(),
  artifactFlags: z.array(z.string()),
});

// ── Prompt ──

function buildQaPrompt(input: MinimalQaInput): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are a UGC ad quality assessor. Evaluate the generated video for realism and authenticity.

Check for:
- Face consistency and natural appearance (no distortion, drift, or uncanny valley)
- Hand/body naturalness (no warping, extra fingers, impossible poses)
- Product/text integrity (if product shown, is it recognizable and text legible?)
- UGC authenticity (does it feel like a real person made this, not AI-generated?)
- Audio-visual sync (if applicable)

Return a JSON object:
{
  "decision": "pass" | "review" | "fail",
  "reasoning": "Brief explanation",
  "artifactFlags": ["face_drift", "hand_warp", "product_warp", "text_illegible", "uncanny_valley", "sync_mismatch"]
}

Guidelines:
- "pass": No major artifacts, looks authentic
- "review": Minor issues that a human should check
- "fail": Clear artifacts that would be noticed by viewers

Respond ONLY with the JSON object.`;

  const userMessage = `Evaluate this UGC video for quality:

**Video URL:** ${input.videoUrl}
**Creative brief:** ${input.specDescription}

Assess the video and return your quality verdict.`;

  return { systemPrompt, userMessage };
}

/**
 * Minimal QA: single Claude Vision pass.
 * Returns a RealismScore-compatible object with overall decision.
 * SP6 replaces this with the full hybrid scorer.
 */
export async function evaluateMinimalQa(input: MinimalQaInput): Promise<RealismScore> {
  const { systemPrompt, userMessage } = buildQaPrompt(input);

  const result = await callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    userMessage,
    schema: MinimalQaOutputSchema,
    maxTokens: 1024,
  });

  return {
    hardChecks: {
      artifactFlags: result.artifactFlags,
    },
    softScores: {},
    overallDecision: result.decision,
  };
}
