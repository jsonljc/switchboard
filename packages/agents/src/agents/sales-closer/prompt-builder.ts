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
  bookingUrl: string;
  urgencyEnabled: boolean;
}

const AGENT_INSTRUCTIONS = `You are the Sales Closer agent for a med spa business. Your job is to:
1. Convert qualified leads into confirmed bookings using the knowledge base context provided.
2. Reference testimonials and social proof from the knowledge base when natural in conversation.
3. Identify the optimal moment to share the booking link — when the client shows clear intent.
4. Handle objections with empathy, using knowledge base context for responses.
5. If the client hesitates, acknowledge their concern before re-framing the value.
6. Never pressure or use manipulative tactics. Guide them naturally toward booking.`;

const URGENCY_ADDENDUM = `\n\nWhen relevant, mention limited slots, current promotions, or seasonal offers from the knowledge base to create natural urgency. Do NOT fabricate urgency — only reference real availability or offers from the context.`;

export function buildSalesCloserPrompt(input: SalesCloserPromptInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);
  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;
  instructions += `\n\nBooking link: ${input.bookingUrl} — share this when the client is ready to book.`;

  if (input.urgencyEnabled) {
    instructions += URGENCY_ADDENDUM;
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}
