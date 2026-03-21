import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { requireOrganizationScope } from "../utils/require-org.js";

interface DocumentListItem {
  documentId: string;
  fileName: string;
  sourceType: string;
  chunkCount: number;
  uploadedAt: string;
}

function buildDocumentList(
  chunks: Array<{
    documentId: string;
    sourceType: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }>,
): DocumentListItem[] {
  const grouped = new Map<
    string,
    { sourceType: string; count: number; earliest: Date; fileName?: string }
  >();

  for (const chunk of chunks) {
    const existing = grouped.get(chunk.documentId);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(chunk.documentId, {
        sourceType: chunk.sourceType,
        count: 1,
        earliest: chunk.createdAt,
        fileName: (chunk.metadata.fileName as string) ?? chunk.documentId,
      });
    }
  }

  return Array.from(grouped.entries()).map(([docId, info]) => ({
    documentId: docId,
    fileName: info.fileName ?? docId,
    sourceType: info.sourceType,
    chunkCount: info.count,
    uploadedAt: info.earliest.toISOString(),
  }));
}

export const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/knowledge/upload
  app.post(
    "/upload",
    {
      schema: {
        description: "Upload a document and chunk it into knowledge base (zero-vector embeddings).",
        tags: ["Knowledge"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const body = request.body as {
        content: string;
        fileName: string;
        agentId?: string;
        sourceType?: string;
      };

      if (!body.content || !body.fileName) {
        return reply.code(400).send({
          error: "content and fileName are required",
          statusCode: 400,
        });
      }

      const documentId = randomUUID();
      const agentId = body.agentId ?? "global";
      const sourceType = body.sourceType ?? "document";

      // Simple word-based chunking: 500 words per chunk
      const words = body.content.split(/\s+/);
      const chunkSize = 500;
      const chunks = [];

      for (let i = 0; i < words.length; i += chunkSize) {
        const chunkWords = words.slice(i, i + chunkSize);
        chunks.push(chunkWords.join(" "));
      }

      // Store chunks with zero-vector embeddings (real embeddings require API key)
      const zeroVector = `[${new Array(1024).fill(0).join(",")}]`;

      for (let idx = 0; idx < chunks.length; idx++) {
        const chunkId = randomUUID();
        const content = chunks[idx] ?? "";
        const metadata = JSON.stringify({ fileName: body.fileName });

        await app.prisma.$executeRaw`
          INSERT INTO "KnowledgeChunk" (
            "id", "organizationId", "agentId", "documentId",
            "content", "sourceType", "embedding", "chunkIndex",
            "metadata", "createdAt", "updatedAt"
          ) VALUES (
            ${chunkId}, ${orgId}, ${agentId}, ${documentId},
            ${content}, ${sourceType}, ${zeroVector}::vector, ${idx},
            ${metadata}::jsonb, NOW(), NOW()
          )
        `;
      }

      return reply.code(201).send({
        documentId,
        fileName: body.fileName,
        chunksCreated: chunks.length,
      });
    },
  );

  // GET /api/knowledge/documents
  app.get(
    "/documents",
    {
      schema: {
        description: "List all knowledge documents for the organization, grouped by documentId.",
        tags: ["Knowledge"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const query = request.query as { agentId?: string };

      const chunks = await app.prisma.knowledgeChunk.findMany({
        where: {
          organizationId: orgId,
          ...(query.agentId && { agentId: query.agentId }),
        },
        select: {
          documentId: true,
          sourceType: true,
          createdAt: true,
          metadata: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const documents = buildDocumentList(
        chunks.map((c) => ({
          documentId: c.documentId,
          sourceType: c.sourceType,
          createdAt: c.createdAt,
          metadata: c.metadata as Record<string, unknown>,
        })),
      );

      return reply.code(200).send({ documents });
    },
  );

  // DELETE /api/knowledge/documents/:documentId
  app.delete(
    "/documents/:documentId",
    {
      schema: {
        description: "Delete all chunks for a knowledge document (org-scoped).",
        tags: ["Knowledge"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { documentId } = request.params as { documentId: string };

      const result = await app.prisma.knowledgeChunk.deleteMany({
        where: {
          documentId,
          organizationId: orgId,
        },
      });

      return reply.code(200).send({ deleted: result.count });
    },
  );

  // POST /api/knowledge/corrections
  app.post(
    "/corrections",
    {
      schema: {
        description: "Create a correction-type knowledge chunk with highest retrieval priority.",
        tags: ["Knowledge"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const body = request.body as {
        agentId: string;
        wrongAnswer: string;
        correctAnswer: string;
      };

      if (!body.agentId || !body.wrongAnswer || !body.correctAnswer) {
        return reply.code(400).send({
          error: "agentId, wrongAnswer, and correctAnswer are required",
          statusCode: 400,
        });
      }

      const documentId = randomUUID();
      const correctionId = randomUUID();

      const correctionContent = `CORRECTION: When asked something similar to what produced "${body.wrongAnswer}", the correct answer is: ${body.correctAnswer}`;
      const metadata = JSON.stringify({
        fileName: "correction",
        wrongAnswer: body.wrongAnswer,
        correctAnswer: body.correctAnswer,
      });
      const zeroVector = `[${new Array(1024).fill(0).join(",")}]`;
      const correctionSourceType = "correction";

      await app.prisma.$executeRaw`
        INSERT INTO "KnowledgeChunk" (
          "id", "organizationId", "agentId", "documentId",
          "content", "sourceType", "embedding", "chunkIndex",
          "metadata", "createdAt", "updatedAt"
        ) VALUES (
          ${correctionId}, ${orgId}, ${body.agentId}, ${documentId},
          ${correctionContent}, ${correctionSourceType}, ${zeroVector}::vector, ${0},
          ${metadata}::jsonb, NOW(), NOW()
        )
      `;

      return reply.code(201).send({
        documentId,
        correctionId,
      });
    },
  );
};
