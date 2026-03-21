import type { PrismaClient } from "@prisma/client";

// Local interfaces matching @switchboard/core KnowledgeStore shape.
// Structural typing ensures compatibility when wired at the app layer (Layer 6).

type KnowledgeSourceType = "correction" | "wizard" | "document";

interface KnowledgeChunk {
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

interface RetrievalResult {
  chunk: KnowledgeChunk;
  similarity: number;
}

interface KnowledgeSearchOptions {
  organizationId: string;
  agentId: string;
  topK?: number;
}

interface RawSearchRow {
  id: string;
  organizationId: string;
  agentId: string;
  documentId: string;
  content: string;
  sourceType: string;
  chunkIndex: number;
  metadata: string | Record<string, unknown>;
  similarity: number;
}

const DEFAULT_TOP_K = 5;

export class PrismaKnowledgeStore {
  constructor(public readonly prisma: PrismaClient) {}

  async store(chunk: KnowledgeChunk): Promise<void> {
    const vectorStr = `[${chunk.embedding.join(",")}]`;
    await this.prisma.$executeRaw`
      INSERT INTO "KnowledgeChunk" (
        "id", "organizationId", "agentId", "documentId",
        "content", "sourceType", "embedding", "chunkIndex",
        "metadata", "createdAt", "updatedAt"
      ) VALUES (
        ${chunk.id}, ${chunk.organizationId}, ${chunk.agentId}, ${chunk.documentId},
        ${chunk.content}, ${chunk.sourceType}, ${vectorStr}::vector, ${chunk.chunkIndex},
        ${JSON.stringify(chunk.metadata)}::jsonb, NOW(), NOW()
      )
    `;
  }

  async storeBatch(chunks: KnowledgeChunk[]): Promise<void> {
    for (const chunk of chunks) {
      await this.store(chunk);
    }
  }

  async search(embedding: number[], options: KnowledgeSearchOptions): Promise<RetrievalResult[]> {
    const topK = options.topK ?? DEFAULT_TOP_K;
    const vectorStr = `[${embedding.join(",")}]`;

    const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT
        "id", "organizationId", "agentId", "documentId",
        "content", "sourceType", "chunkIndex", "metadata",
        1 - ("embedding" <=> ${vectorStr}::vector) AS similarity
      FROM "KnowledgeChunk"
      WHERE "organizationId" = ${options.organizationId}
        AND "agentId" = ${options.agentId}
      ORDER BY "embedding" <=> ${vectorStr}::vector
      LIMIT ${topK}
    `;

    return rows.map((row) => ({
      chunk: {
        id: row.id,
        organizationId: row.organizationId,
        agentId: row.agentId,
        documentId: row.documentId,
        content: row.content,
        sourceType: row.sourceType as KnowledgeSourceType,
        embedding: [], // Don't return raw embedding vectors in search results
        chunkIndex: row.chunkIndex,
        metadata:
          typeof row.metadata === "string"
            ? (JSON.parse(row.metadata) as Record<string, unknown>)
            : (row.metadata as Record<string, unknown>),
      },
      similarity: row.similarity,
    }));
  }

  async deleteByDocument(documentId: string): Promise<number> {
    const result = await this.prisma.knowledgeChunk.deleteMany({
      where: { documentId },
    });
    return result.count;
  }
}
