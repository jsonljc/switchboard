import type { EmbeddingAdapter } from "../embedding-adapter.js";
import type { KnowledgeStore, KnowledgeChunk, KnowledgeSourceType } from "../knowledge-store.js";
import { chunkText } from "./chunker.js";

export interface IngestionInput {
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  documentId: string;
  content: string;
  sourceType: KnowledgeSourceType;
  metadata?: Record<string, unknown>;
}

export interface IngestionResult {
  documentId: string;
  chunksCreated: number;
}

export interface IngestionPipelineConfig {
  embedding: EmbeddingAdapter;
  store: KnowledgeStore;
  maxTokensPerChunk?: number;
  overlapTokens?: number;
}

function generateId(): string {
  return crypto.randomUUID();
}

export class IngestionPipeline {
  private readonly embedding: EmbeddingAdapter;
  private readonly store: KnowledgeStore;
  private readonly maxTokensPerChunk: number;
  private readonly overlapTokens: number;

  constructor(config: IngestionPipelineConfig) {
    this.embedding = config.embedding;
    this.store = config.store;
    this.maxTokensPerChunk = config.maxTokensPerChunk ?? 500;
    this.overlapTokens = config.overlapTokens ?? 50;
  }

  async ingest(input: IngestionInput): Promise<IngestionResult> {
    if (!input.content.trim()) {
      return { documentId: input.documentId, chunksCreated: 0 };
    }

    await this.store.deleteByDocument(input.documentId);

    const textChunks = chunkText(input.content, {
      maxTokens: this.maxTokensPerChunk,
      overlapTokens: this.overlapTokens,
    });

    if (textChunks.length === 0) {
      return { documentId: input.documentId, chunksCreated: 0 };
    }

    const embeddings = await this.embedding.embedBatch(textChunks.map((c) => c.content));

    const chunks: KnowledgeChunk[] = textChunks.map((tc, i) => ({
      id: generateId(),
      organizationId: input.organizationId,
      agentId: input.agentId,
      deploymentId: input.deploymentId,
      documentId: input.documentId,
      content: tc.content,
      sourceType: input.sourceType,
      embedding: embeddings[i] ?? [],
      chunkIndex: tc.index,
      metadata: input.metadata ?? {},
    }));

    await this.store.storeBatch(chunks);

    return { documentId: input.documentId, chunksCreated: chunks.length };
  }
}
