import type { EmbeddingAdapter } from "../embedding-adapter.js";

export class EmbeddingsUnavailableError extends Error {
  constructor() {
    super("Embedding provider not configured — semantic search unavailable");
    this.name = "EmbeddingsUnavailableError";
  }
}

export class DisabledEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = 1024;
  readonly available = false;

  async embed(_text: string): Promise<number[]> {
    throw new EmbeddingsUnavailableError();
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new EmbeddingsUnavailableError();
  }
}
