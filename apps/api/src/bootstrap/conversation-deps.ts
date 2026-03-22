// ---------------------------------------------------------------------------
// Conversation Deps Factory — builds LLM + embedding + retrieval deps
// ---------------------------------------------------------------------------
// Used by agent handlers (LeadResponder, SalesCloser) for conversational AI.
// Returns null when required config is missing, allowing degraded boot.
// ---------------------------------------------------------------------------

import { ClaudeLLMAdapter, ClaudeEmbeddingAdapter } from "@switchboard/agents";
import type { LLMCompleteFn, EmbeddingClient } from "@switchboard/agents";
import { KnowledgeRetriever } from "@switchboard/agents";
import type { ConversationStore, LLMAdapter, EmbeddingAdapter } from "@switchboard/core";
import type { KnowledgeStore } from "@switchboard/core";

export interface ConversationDepsInput {
  anthropicApiKey?: string;
  conversationStore?: ConversationStore;
  knowledgeStore?: KnowledgeStore;
  model?: string;
  /** Voyage AI API key for real embeddings. When absent, uses zero-vector stubs. */
  voyageApiKey?: string;
}

export interface ConversationDeps {
  llm: LLMAdapter;
  retriever: KnowledgeRetriever;
  conversationStore: ConversationStore;
  embeddingAdapter: EmbeddingAdapter;
}

export function buildConversationDeps(input: ConversationDepsInput): ConversationDeps | null {
  const { anthropicApiKey, conversationStore, knowledgeStore } = input;

  if (!anthropicApiKey || !conversationStore || !knowledgeStore) {
    return null;
  }

  const model = input.model ?? "claude-haiku-4-5-20251001";

  const complete: LLMCompleteFn = async (messages) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: messages.find((m) => m.role === "system")?.content ?? "",
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    return data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  };

  const llm = new ClaudeLLMAdapter({ complete });

  const createEmbeddingFn: EmbeddingClient["createEmbedding"] = input.voyageApiKey
    ? async (params) => {
        const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.voyageApiKey}`,
          },
          body: JSON.stringify({
            input: params.texts,
            model: "voyage-3-lite",
          }),
        });

        if (!resp.ok) {
          return { embeddings: params.texts.map(() => new Array(1024).fill(0)) };
        }

        const result = (await resp.json()) as {
          data: Array<{ embedding: number[] }>;
        };
        return { embeddings: result.data.map((d) => d.embedding) };
      }
    : async (params) => {
        return { embeddings: params.texts.map(() => new Array(1024).fill(0)) };
      };

  const embeddingAdapter = new ClaudeEmbeddingAdapter({
    createEmbedding: createEmbeddingFn,
    model: "voyage-3-lite",
  });

  const retriever = new KnowledgeRetriever({
    store: knowledgeStore,
    embedding: embeddingAdapter,
  });

  return { llm, retriever, conversationStore, embeddingAdapter };
}
