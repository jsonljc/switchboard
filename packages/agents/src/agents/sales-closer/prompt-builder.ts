// ---------------------------------------------------------------------------
// Prompt Builder — assembles ConversationPrompt for Sales Closer LLM calls
// ---------------------------------------------------------------------------

import type { ConversationPrompt, Message, RetrievedChunk } from "@switchboard/core";
import type { AgentContextData } from "@switchboard/schemas";
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
  threadContext?: AgentContextData;
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

  if (input.threadContext) {
    instructions += buildThreadContextBlock(input.threadContext);
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}

function buildThreadContextBlock(ctx: AgentContextData): string {
  const parts: string[] = ["\n\n--- CONVERSATION MEMORY ---"];
  if (ctx.objectionsEncountered.length > 0) {
    parts.push(`Objections raised: ${ctx.objectionsEncountered.join(", ")}`);
  }
  const prefs = Object.entries(ctx.preferencesLearned);
  if (prefs.length > 0) {
    parts.push(`Known preferences: ${prefs.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }
  if (ctx.topicsDiscussed.length > 0) {
    parts.push(`Topics covered: ${ctx.topicsDiscussed.join(", ")}`);
  }
  if (ctx.sentimentTrend !== "unknown") {
    parts.push(`Lead sentiment: ${ctx.sentimentTrend}`);
  }
  if (ctx.offersMade.length > 0) {
    parts.push(`Offers made: ${ctx.offersMade.map((o) => o.description).join(", ")}`);
  }
  parts.push(
    "Use this memory to maintain continuity. Don't repeat offers or re-ask answered questions.",
  );
  parts.push("--- END MEMORY ---");
  return parts.join("\n");
}
