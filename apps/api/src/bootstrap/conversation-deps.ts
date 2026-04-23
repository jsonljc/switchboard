// ---------------------------------------------------------------------------
// Conversation Deps Factory — builds LLM + embedding + retrieval deps
// ---------------------------------------------------------------------------
// Used by agent handlers (LeadResponder, SalesCloser) for conversational AI.
// Returns null when required config is missing, allowing degraded boot.
// ---------------------------------------------------------------------------

import {
  ClaudeLLMAdapter,
  ClaudeEmbeddingAdapter,
  DisabledEmbeddingAdapter,
  KnowledgeRetriever,
} from "@switchboard/core";
import type {
  LLMCompleteFn,
  EmbeddingClient,
  ConversationStore,
  LLMAdapter,
  EmbeddingAdapter,
  KnowledgeStore,
} from "@switchboard/core";

export interface ConversationDepsInput {
  anthropicApiKey?: string;
  conversationStore?: ConversationStore;
  knowledgeStore?: KnowledgeStore;
  model?: string;
  /** Voyage AI API key for real embeddings. When absent, semantic search is disabled. */
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
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Anthropic API error: ${response.status} ${errorBody}`);
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

  let embeddingAdapter: EmbeddingAdapter;

  if (input.voyageApiKey) {
    const createEmbeddingFn: EmbeddingClient["createEmbedding"] = async (params) => {
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
        const body = await resp.text().catch(() => "");
        throw new Error(`Voyage API error ${resp.status}: ${body}`);
      }

      const result = (await resp.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return { embeddings: result.data.map((d) => d.embedding) };
    };

    embeddingAdapter = new ClaudeEmbeddingAdapter({
      createEmbedding: createEmbeddingFn,
      model: "voyage-3-lite",
    });
  } else {
    console.warn("[boot] Embedding provider not configured — semantic search disabled");
    embeddingAdapter = new DisabledEmbeddingAdapter();
  }

  const retriever = new KnowledgeRetriever({
    store: knowledgeStore,
    embedding: embeddingAdapter,
  });

  return { llm, retriever, conversationStore, embeddingAdapter };
}
