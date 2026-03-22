// ---------------------------------------------------------------------------
// Prompt Builder — assembles ConversationPrompt for Lead Responder LLM calls
// ---------------------------------------------------------------------------

import type { ConversationPrompt, Message, RetrievedChunk } from "@switchboard/core";
import type { AgentContextData } from "@switchboard/schemas";
import { getTonePreset, type TonePreset } from "./tone-presets.js";
import { getLanguageDirective, type SupportedLanguage } from "./language-directives.js";

export interface PromptBuildInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  bookingLink?: string;
  testMode?: boolean;
  threadContext?: AgentContextData;
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
