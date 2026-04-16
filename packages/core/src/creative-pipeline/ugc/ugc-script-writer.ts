// packages/core/src/creative-pipeline/ugc/ugc-script-writer.ts
import { callClaude } from "../stages/call-claude.js";
import { z } from "zod";

// ── Types ──

interface ScriptBrief {
  productDescription: string;
  targetAudience: string;
  brandVoice: string | null;
}

interface ScriptCreator {
  name: string;
  personality: {
    energy: string;
    deliveryStyle: string;
    catchphrases?: string[];
    forbiddenPhrases?: string[];
  };
}

interface ScriptStructure {
  id: string;
  name: string;
  sections: Array<{ name: string; purposeGuide: string; durationRange: [number, number] }>;
}

export interface UgcScriptInput {
  brief: ScriptBrief;
  creator: ScriptCreator;
  structure: ScriptStructure;
  scriptConstraints: string[];
  hookDirectives: string[];
  apiKey: string;
}

// ── Output schema (simple for SP4 — just the script text) ──

const UgcScriptOutputSchema = z.object({
  text: z.string(),
  language: z.string().default("en"),
  claimsPolicyTag: z.string().optional(),
});

export type UgcScriptOutput = z.infer<typeof UgcScriptOutputSchema>;

// ── Prompt builder ──

export function buildUgcScriptPrompt(input: Omit<UgcScriptInput, "apiKey">): {
  systemPrompt: string;
  userMessage: string;
} {
  const { brief, creator, structure, scriptConstraints, hookDirectives } = input;

  const catchphrases = creator.personality.catchphrases?.join(", ") ?? "none";
  const forbidden = creator.personality.forbiddenPhrases?.join(", ") ?? "none";

  const systemPrompt = `You are writing a UGC ad script as ${creator.name}, a ${creator.personality.energy} creator with a ${creator.personality.deliveryStyle} delivery style.

## Creator Voice
- Energy: ${creator.personality.energy}
- Style: ${creator.personality.deliveryStyle}
- Catchphrases to naturally include: ${catchphrases}
- NEVER use these phrases: ${forbidden}

## UGC Authenticity Rules
- Write like a real person talking, NOT like ad copy
- Include natural filler words (um, like, honestly, you know) at 15-25% density
- Add hesitation points — places where the speaker pauses mid-thought
- Include sentence fragments and incomplete thoughts that get restarted
- Allow micro pauses between ideas (marked with ...)
- FORBIDDEN: "limited time offer", "act now", "don't miss out", "click the link below"
- The script should feel like someone talking to a friend, not reading a teleprompter

## Output Format
Return a JSON object:
{
  "text": "The complete script text with natural speech patterns",
  "language": "en"
}

Respond ONLY with the JSON object.`;

  // Build structure guidance
  const sectionGuide = structure.sections
    .map((s) => `- **${s.name}** (${s.durationRange[0]}-${s.durationRange[1]}s): ${s.purposeGuide}`)
    .join("\n");

  let userMessage = `Write a UGC script for this ad:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
${brief.brandVoice ? `**Brand Voice:** ${brief.brandVoice}` : ""}

**Ad Structure (${structure.name}):**
${sectionGuide}`;

  if (scriptConstraints.length > 0) {
    userMessage += `\n\n**Script Constraints:**\n${scriptConstraints.map((c) => `- ${c}`).join("\n")}`;
  }

  if (hookDirectives.length > 0) {
    userMessage += `\n\n**Hook Directives:**\n${hookDirectives.map((d) => `- ${d}`).join("\n")}`;
  }

  return { systemPrompt, userMessage };
}

// ── Runner ──

export async function runUgcScriptWriter(input: UgcScriptInput): Promise<UgcScriptOutput> {
  const { systemPrompt, userMessage } = buildUgcScriptPrompt(input);

  return callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    userMessage,
    schema: UgcScriptOutputSchema,
    maxTokens: 4096,
  });
}
