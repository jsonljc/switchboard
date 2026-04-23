// ---------------------------------------------------------------------------
// Embedding Adapter — provider-agnostic embedding interface
// ---------------------------------------------------------------------------

export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly available: boolean;
}
