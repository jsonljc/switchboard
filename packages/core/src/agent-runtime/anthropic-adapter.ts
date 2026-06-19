import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter, ConversationPrompt, LLMReply, RetrievedChunk } from "../llm-adapter.js";
import { modelSupportsSamplingParams, type ModelConfig } from "../model-router.js";
import { recordLlmCacheEffectiveness } from "../telemetry/metrics.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;

// Build the system prompt as content blocks so prompt caching can mark only the
// static base prompt with cache_control. Order is preserved (base -> retrieved
// context -> agent instructions) so the model sees the same content; only the
// base prompt block is cached. The per-turn RAG context and the trailing agent
// instructions are intentionally left uncached to keep the cached prefix
// byte-stable across turns — a dynamic value in the prefix would bust the cache.
function buildSystemContent(prompt: ConversationPrompt): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: prompt.systemPrompt, cache_control: { type: "ephemeral" } },
  ];

  if (prompt.retrievedContext.length > 0) {
    const contextLines = prompt.retrievedContext.map(
      (c: RetrievedChunk, i: number) =>
        `[Source ${i + 1} (${c.sourceType}, similarity: ${c.similarity.toFixed(2)})]:\n${c.content}`,
    );
    blocks.push({ type: "text", text: `Relevant context:\n${contextLines.join("\n\n")}` });
  }

  if (prompt.agentInstructions) {
    blocks.push({ type: "text", text: prompt.agentInstructions });
  }

  return blocks;
}

export function createAnthropicAdapter(apiKey?: string): LLMAdapter {
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

  return {
    async generateReply(prompt: ConversationPrompt, modelConfig?: ModelConfig): Promise<LLMReply> {
      const messages = prompt.conversationHistory.map((m) => ({
        role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      const model = modelConfig?.modelId ?? DEFAULT_MODEL;
      const response = await client.messages.create({
        model,
        max_tokens: modelConfig?.maxTokens ?? DEFAULT_MAX_TOKENS,
        // Generation-aware sampling: 4.7+ ids reject temperature/top_p/top_k with a
        // hard 400, so send temperature only when explicitly set AND the target
        // model accepts it. A no-op on today's 4.6 routes; removes a latent 400.
        ...(modelConfig?.temperature !== undefined && modelSupportsSamplingParams(model)
          ? { temperature: modelConfig.temperature }
          : {}),
        system: buildSystemContent(prompt),
        messages,
      });

      // Per-call prompt-cache effectiveness (hit/populate/miss + zero-read warn).
      recordLlmCacheEffectiveness({
        model,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "";

      return { reply: text, confidence: 0.9 };
    },
  };
}
