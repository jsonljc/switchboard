// ---------------------------------------------------------------------------
// Prompt Builder — assembles ConversationPrompt for Sales Closer LLM calls
// ---------------------------------------------------------------------------

import type { ConversationPrompt, Message, RetrievedChunk } from "@switchboard/core";
import { getTonePreset, type TonePreset } from "../lead-responder/tone-presets.js";
import {
  getLanguageDirective,
  type SupportedLanguage,
} from "../lead-responder/language-directives.js";

export interface SalesCloserPromptInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  bookingUrl?: string;
  urgencyEnabled?: boolean;
}

const AGENT_INSTRUCTIONS = `You are the Sales Closer agent for a med spa business. Your job is to:
1. Move qualified leads toward booking an appointment using ONLY the knowledge base context provided.
2. Address objections, answer final questions, and build urgency when appropriate.
3. If asked something outside your knowledge base context, say you'll check with the team — do NOT guess.
4. If the conversation becomes sensitive (medical advice, pricing exceptions, complaints), escalate immediately.
5. Be direct but warm — this lead is already qualified, so focus on closing the booking.`;

const URGENCY_ADDENDUM = `\n\n6. When appropriate, gently highlight limited availability, seasonal offers, or time-sensitive pricing to encourage immediate booking.`;

export function buildSalesCloserPrompt(input: SalesCloserPromptInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);

  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;

  if (input.urgencyEnabled) {
    instructions += URGENCY_ADDENDUM;
  }

  if (input.bookingUrl) {
    instructions += `\n\nBooking link: ${input.bookingUrl} — share this when the client is ready to book.`;
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}
