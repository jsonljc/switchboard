// ---------------------------------------------------------------------------
// Prompt Builder — assembles ConversationPrompt for Nurture cadence messages
// ---------------------------------------------------------------------------

import type { ConversationPrompt, Message, RetrievedChunk } from "@switchboard/core";
import { getTonePreset, type TonePreset } from "../lead-responder/tone-presets.js";
import {
  getLanguageDirective,
  type SupportedLanguage,
} from "../lead-responder/language-directives.js";

export interface NurturePromptInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  cadenceType: string;
  templateKey: string;
  reviewPlatformLink?: string;
}

const AGENT_INSTRUCTIONS = `You are the Nurture agent for a med spa business. Your job is to:
1. Generate a personalized cadence message using the knowledge base context and conversation history.
2. Keep messages warm, concise, and action-oriented.
3. Match the cadence type and template purpose — do NOT deviate from the message intent.
4. Never pressure the client. A gentle, caring tone is essential.
5. If the message is a review request, include the review link naturally.`;

export function buildNurturePrompt(input: NurturePromptInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);
  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;
  instructions += `\n\nCadence type: ${input.cadenceType}`;
  instructions += `\nTemplate: ${input.templateKey}`;

  if (input.reviewPlatformLink) {
    instructions += `\nReview link: ${input.reviewPlatformLink} — include this link naturally when requesting a review.`;
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}
