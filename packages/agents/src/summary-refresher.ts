// ---------------------------------------------------------------------------
// Summary Refresher — LLM-based conversation summary regeneration
// ---------------------------------------------------------------------------

import type { LLMAdapter, Message } from "@switchboard/core";

const SUMMARY_PROMPT = `Summarize this conversation in 2-3 sentences. Focus on:
- What the lead is interested in
- Key questions or concerns raised
- Current status of the conversation (exploring, ready to book, hesitant, etc.)

Return ONLY the summary text, no formatting or labels.`;

/**
 * Check if the conversation summary should be refreshed based on message count.
 */
export function shouldRefreshSummary(messageCount: number, interval: number): boolean {
  return messageCount > 0 && messageCount % interval === 0;
}

/**
 * Generate a fresh conversation summary via LLM.
 * Returns empty string on failure.
 */
export async function refreshSummary(llm: LLMAdapter, history: Message[]): Promise<string> {
  if (history.length === 0) return "";

  try {
    const reply = await llm.generateReply({
      systemPrompt: "You are a conversation summarizer. Be concise and factual.",
      conversationHistory: history,
      retrievedContext: [],
      agentInstructions: SUMMARY_PROMPT,
    });
    return reply.reply.trim();
  } catch {
    return "";
  }
}
