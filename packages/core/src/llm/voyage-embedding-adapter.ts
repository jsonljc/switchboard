import type { EmbeddingAdapter } from "../embedding-adapter.js";

export interface VoyageEmbeddingAdapterConfig {
  apiKey: string;
  model?: string;
}

interface VoyageResponse {
  data: Array<{ embedding: number[] }>;
}

const DEFAULT_MODEL = "voyage-3-large";
const DIMENSIONS = 1024;
const API_URL = "https://api.voyageai.com/v1/embeddings";

export class VoyageEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = DIMENSIONS;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: VoyageEmbeddingAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.callApi([text]);
    return result[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.callApi(texts);
  }

  private async callApi(input: string[]): Promise<number[][]> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input, model: this.model }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Voyage API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as VoyageResponse;
    return data.data.map((d) => d.embedding);
  }
}
