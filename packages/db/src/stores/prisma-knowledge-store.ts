import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

// Local interfaces matching @switchboard/core KnowledgeStore shape.
// Structural typing ensures compatibility when wired at the app layer (Layer 6).

type KnowledgeSourceType = "correction" | "wizard" | "document" | "learned";

interface KnowledgeChunk {
  id: string;
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  documentId: string;
  content: string;
  sourceType: KnowledgeSourceType;
  embedding: number[];
  chunkIndex: number;
  metadata: Record<string, unknown>;
  draftStatus?: string | null;
  draftExpiresAt?: Date | null;
}

interface RetrievalResult {
  chunk: KnowledgeChunk;
  similarity: number;
}

interface KnowledgeSearchOptions {
  organizationId: string;
  agentId: string;
  deploymentId?: string;
  topK?: number;
}

interface RawSearchRow {
  id: string;
  organizationId: string;
  agentId: string;
  deploymentId: string | null;
  documentId: string;
  content: string;
  sourceType: string;
  chunkIndex: number;
  metadata: string | Record<string, unknown>;
  similarity: number;
}

const DEFAULT_TOP_K = 5;

const SOURCE_BOOST: Record<string, number> = {
  correction: 1.3,
  wizard: 1.15,
  learned: 1.1,
  document: 1.0,
};

export class PrismaKnowledgeStore {
  constructor(public readonly prisma: PrismaClient) {}

  async store(chunk: KnowledgeChunk): Promise<void> {
    const vectorStr = `[${chunk.embedding.join(",")}]`;
    await this.prisma.$executeRaw`
      INSERT INTO "KnowledgeChunk" (
        "id", "organizationId", "agentId", "deploymentId", "documentId",
        "content", "sourceType", "embedding", "chunkIndex",
        "metadata", "draftStatus", "draftExpiresAt", "createdAt", "updatedAt"
      ) VALUES (
        ${chunk.id}, ${chunk.organizationId}, ${chunk.agentId}, ${chunk.deploymentId ?? null}, ${chunk.documentId},
        ${chunk.content}, ${chunk.sourceType}, ${vectorStr}::vector, ${chunk.chunkIndex},
        ${JSON.stringify(chunk.metadata)}::jsonb, ${chunk.draftStatus ?? null}, ${chunk.draftExpiresAt ?? null}, NOW(), NOW()
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

    const deploymentFilter = options.deploymentId
      ? Prisma.sql`AND ("deploymentId" = ${options.deploymentId} OR "deploymentId" IS NULL)`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT
        "id", "organizationId", "agentId", "deploymentId", "documentId",
        "content", "sourceType", "chunkIndex", "metadata",
        1 - ("embedding" <=> ${vectorStr}::vector) AS similarity
      FROM "KnowledgeChunk"
      WHERE "organizationId" = ${options.organizationId}
        AND "agentId" = ${options.agentId}
        ${deploymentFilter}
      ORDER BY "embedding" <=> ${vectorStr}::vector
      LIMIT ${topK}
    `;

    return rows.map((row) => ({
      chunk: {
        id: row.id,
        organizationId: row.organizationId,
        agentId: row.agentId,
        deploymentId: row.deploymentId ?? undefined,
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
      similarity: row.similarity * (SOURCE_BOOST[row.sourceType] ?? 1.0),
    }));
  }

  async deleteByDocument(documentId: string): Promise<number> {
    const result = await this.prisma.knowledgeChunk.deleteMany({
      where: { documentId },
    });
    return result.count;
  }
}
