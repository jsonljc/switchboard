// ---------------------------------------------------------------------------
// Claude LLM Adapter — Claude API implementation of LLMAdapter
// ---------------------------------------------------------------------------
// Generates conversational replies with confidence scoring.
// Confidence is the LLM self-reported score (v1 limitation — see design doc
// Section 6 for known calibration weakness). The retrieval-based confidence
// cap is applied in the retrieval layer, not here.
// ---------------------------------------------------------------------------

import type { LLMAdapter, ConversationPrompt, LLMReply, RetrievedChunk } from "@switchboard/core";
import type { Message } from "@switchboard/core";

export interface LLMCompleteFn {
  (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string>;
}

export interface ClaudeLLMAdapterConfig {
  complete: LLMCompleteFn;
}

function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  const lines = chunks.map(
    (c, i) =>
      `[Source ${i + 1} (${c.sourceType}, similarity: ${c.similarity.toFixed(2)})]:\n${c.content}`,
  );

  return `\n\nRelevant knowledge base context:\n${lines.join("\n\n")}`;
}

function historyToMessages(
  history: Message[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((m) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));
}

function clampConfidence(value: unknown): number {
  const num = typeof value === "number" ? value : 0;
  return Math.max(0, Math.min(1, num));
}

const RESPONSE_FORMAT_INSTRUCTION = `
Respond with a JSON object containing exactly two fields:
- "reply": your conversational response text (string)
- "confidence": your confidence that this reply is accurate and appropriate (number 0-1)

Return ONLY the JSON object, no markdown formatting.`;

export class ClaudeLLMAdapter implements LLMAdapter {
  private readonly completeFn: LLMCompleteFn;

  constructor(config: ClaudeLLMAdapterConfig) {
    this.completeFn = config.complete;
  }

  async generateReply(prompt: ConversationPrompt): Promise<LLMReply> {
    const contextBlock = buildContextBlock(prompt.retrievedContext);

    const systemContent =
      prompt.systemPrompt +
      contextBlock +
      "\n\n" +
      prompt.agentInstructions +
      RESPONSE_FORMAT_INSTRUCTION;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemContent },
      ...historyToMessages(prompt.conversationHistory),
    ];

    const raw = await this.completeFn(messages);

    try {
      const parsed = JSON.parse(raw) as { reply?: string; confidence?: unknown };
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : raw,
        confidence: clampConfidence(parsed.confidence),
      };
    } catch {
      // Malformed JSON — use raw text with 0 confidence (triggers escalation)
      return { reply: raw, confidence: 0 };
    }
  }
}
