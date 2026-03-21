// ---------------------------------------------------------------------------
// Prompt Builder — assembles ConversationPrompt for Lead Responder LLM calls
// ---------------------------------------------------------------------------

import type { ConversationPrompt, Message, RetrievedChunk } from "@switchboard/core";
import { getTonePreset, type TonePreset } from "./tone-presets.js";
import { getLanguageDirective, type SupportedLanguage } from "./language-directives.js";

export interface PromptBuildInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  bookingLink?: string;
  testMode?: boolean;
}

const AGENT_INSTRUCTIONS = `You are the Lead Responder agent for a med spa business. Your job is to:
1. Answer questions about services, pricing, availability, and the business using ONLY the knowledge base context provided.
2. Watch for qualification signals: interest in specific treatments, budget mentions, urgency, booking intent.
3. If you detect qualification signals, mention them naturally in your response (the system will score separately).
4. If asked something outside your knowledge base context, say you'll check with the team — do NOT guess.
5. If the conversation becomes sensitive (medical advice, pricing exceptions, complaints), escalate immediately.
6. Never pressure the client. Guide them naturally toward booking.`;

const TEST_MODE_ADDENDUM = `\n\nYou are currently in test mode. The business owner is testing your responses. Answer exactly as you would with a real client. The owner may flag incorrect answers for correction.`;

export function buildConversationPrompt(input: PromptBuildInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);

  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;

  if (input.bookingLink) {
    instructions += `\n\nBooking link: ${input.bookingLink} — share this when the client is ready to book.`;
  }

  if (input.testMode) {
    instructions += TEST_MODE_ADDENDUM;
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}
