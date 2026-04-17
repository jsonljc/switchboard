import type { EmbeddingAdapter } from "../embedding-adapter.js";
import type { KnowledgeStore, KnowledgeSourceType } from "../knowledge-store.js";
import type { RetrievedChunk } from "../llm-adapter.js";

const SOURCE_BOOST: Record<KnowledgeSourceType, number> = {
  correction: 1.3,
  wizard: 1.15,
  learned: 1.1,
  document: 1.0,
};

const DEFAULT_TOP_K = 5;
const DEFAULT_RETRIEVAL_THRESHOLD = 0.7;
const LOW_SIMILARITY_CAP = 0.4;

export interface RetrievalConfig {
  embedding: EmbeddingAdapter;
  store: KnowledgeStore;
  topK?: number;
}

export interface RetrieveOptions {
  organizationId: string;
  agentId: string;
  deploymentId?: string;
}

export interface ConfidenceInput {
  bestSimilarity: number;
  llmSelfReport: number;
  retrievalThreshold?: number;
}

export function computeConfidence(input: ConfidenceInput): number {
  const threshold = input.retrievalThreshold ?? DEFAULT_RETRIEVAL_THRESHOLD;

  if (input.bestSimilarity === 0) {
    return 0;
  }

  let retrievalConfidence = input.bestSimilarity;
  if (input.bestSimilarity < threshold) {
    retrievalConfidence = LOW_SIMILARITY_CAP;
  }

  return Math.min(retrievalConfidence, input.llmSelfReport);
}

export class KnowledgeRetriever {
  private readonly embedding: EmbeddingAdapter;
  private readonly store: KnowledgeStore;
  private readonly topK: number;

  constructor(config: RetrievalConfig) {
    this.embedding = config.embedding;
    this.store = config.store;
    this.topK = config.topK ?? DEFAULT_TOP_K;
  }

  async retrieve(query: string, options: RetrieveOptions): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embedding.embed(query);

    const results = await this.store.search(queryEmbedding, {
      organizationId: options.organizationId,
      agentId: options.agentId,
      deploymentId: options.deploymentId,
      topK: this.topK,
    });

    if (results.length === 0) {
      return [];
    }

    const boosted = results.map((r) => {
      const boost = SOURCE_BOOST[r.chunk.sourceType as KnowledgeSourceType] ?? 1.0;
      return {
        content: r.chunk.content,
        sourceType: r.chunk.sourceType as RetrievedChunk["sourceType"],
        similarity: r.similarity * boost,
        metadata: r.chunk.metadata,
      };
    });

    boosted.sort((a, b) => b.similarity - a.similarity);

    return boosted;
  }
}
