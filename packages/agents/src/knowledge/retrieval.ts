// ---------------------------------------------------------------------------
// Knowledge Retrieval — RAG retrieval with source-type boosting + confidence
// ---------------------------------------------------------------------------
// Retrieval flow per design doc Section 6:
//   1. Embed query -> vector search -> top-k chunks
//   2. Boost source types: correction (1.3x) > wizard (1.15x) > document (1.0x)
//   3. Re-sort by boosted similarity
//
// Confidence scoring (dual-signal, v1):
//   - Primary: retrieval similarity. If best < retrievalThreshold (0.7),
//     confidence capped at 0.4 regardless of LLM self-report.
//   - Secondary: LLM self-reported confidence (known calibration weakness).
//   - Combined: min(retrievalConfidence, llmSelfReport)
// ---------------------------------------------------------------------------

import type { EmbeddingAdapter, KnowledgeStore, KnowledgeSourceType } from "@switchboard/core";
import type { RetrievedChunk } from "@switchboard/core";

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

  // Primary signal: retrieval similarity
  let retrievalConfidence = input.bestSimilarity;
  if (input.bestSimilarity < threshold) {
    retrievalConfidence = LOW_SIMILARITY_CAP;
  }

  // Combined: min of both signals
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

    // Apply source-type boosting and re-sort
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
