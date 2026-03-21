// ---------------------------------------------------------------------------
// Knowledge Store — persistence interface for RAG knowledge chunks
// ---------------------------------------------------------------------------
// Scoped per organizationId + agentId. Three source types with retrieval
// priority: correction > wizard > document (boosting applied at retrieval time).
// Prisma + pgvector implementation lives in packages/db/.
// ---------------------------------------------------------------------------

export type KnowledgeSourceType = "correction" | "wizard" | "document";

export interface KnowledgeChunk {
  id: string;
  organizationId: string;
  agentId: string;
  documentId: string;
  content: string;
  sourceType: KnowledgeSourceType;
  embedding: number[];
  chunkIndex: number;
  metadata: Record<string, unknown>;
}

export interface RetrievalResult {
  chunk: KnowledgeChunk;
  similarity: number;
}

export interface KnowledgeSearchOptions {
  organizationId: string;
  agentId: string;
  topK?: number;
}

export interface KnowledgeStore {
  store(chunk: KnowledgeChunk): Promise<void>;
  storeBatch(chunks: KnowledgeChunk[]): Promise<void>;
  search(embedding: number[], options: KnowledgeSearchOptions): Promise<RetrievalResult[]>;
  deleteByDocument(documentId: string): Promise<number>;
}
