// ---------------------------------------------------------------------------
// Claude Embedding Adapter — Claude API implementation of EmbeddingAdapter
// ---------------------------------------------------------------------------
// Uses Claude's embedding endpoint. Dimensions fixed at 1024.
// The EmbeddingAdapter interface is defined in packages/core/.
// ---------------------------------------------------------------------------

import type { EmbeddingAdapter } from "@switchboard/core";

export interface EmbeddingClient {
  createEmbedding(params: { texts: string[]; model: string }): Promise<{ embeddings: number[][] }>;
}

export interface ClaudeEmbeddingAdapterConfig {
  createEmbedding: EmbeddingClient["createEmbedding"];
  model?: string;
}

const DEFAULT_MODEL = "claude-embed-1";
const DIMENSIONS = 1024;

export class ClaudeEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = DIMENSIONS;
  private readonly createEmbeddingFn: EmbeddingClient["createEmbedding"];
  private readonly model: string;

  constructor(config: ClaudeEmbeddingAdapterConfig) {
    this.createEmbeddingFn = config.createEmbedding;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.createEmbeddingFn({
      texts: [text],
      model: this.model,
    });
    return response.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.createEmbeddingFn({
      texts,
      model: this.model,
    });
    return response.embeddings;
  }
}
