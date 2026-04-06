import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter, ConversationPrompt, LLMReply, RetrievedChunk } from "../llm-adapter.js";
import type { ModelConfig } from "../model-router.js";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 1024;

function buildSystemContent(prompt: ConversationPrompt): string {
  let system = prompt.systemPrompt;

  if (prompt.retrievedContext.length > 0) {
    const contextLines = prompt.retrievedContext.map(
      (c: RetrievedChunk, i: number) =>
        `[Source ${i + 1} (${c.sourceType}, similarity: ${c.similarity.toFixed(2)})]:\n${c.content}`,
    );
    system += `\n\nRelevant context:\n${contextLines.join("\n\n")}`;
  }

  if (prompt.agentInstructions) {
    system += `\n\n${prompt.agentInstructions}`;
  }

  return system;
}

export function createAnthropicAdapter(apiKey?: string): LLMAdapter {
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

  return {
    async generateReply(prompt: ConversationPrompt, modelConfig?: ModelConfig): Promise<LLMReply> {
      const messages = prompt.conversationHistory.map((m) => ({
        role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      const response = await client.messages.create({
        model: modelConfig?.modelId ?? DEFAULT_MODEL,
        max_tokens: modelConfig?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: modelConfig?.temperature,
        system: buildSystemContent(prompt),
        messages,
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "";

      return { reply: text, confidence: 0.9 };
    },
  };
}
