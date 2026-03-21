import { describe, it, expect } from "vitest";
import type { KnowledgeStore, KnowledgeChunk, KnowledgeSourceType } from "../knowledge-store.js";

function createMockStore(): KnowledgeStore {
  const chunks: KnowledgeChunk[] = [];

  return {
    async store(chunk: KnowledgeChunk): Promise<void> {
      chunks.push(chunk);
    },
    async storeBatch(batch: KnowledgeChunk[]): Promise<void> {
      chunks.push(...batch);
    },
    async search(
      _embedding: number[],
      options: { organizationId: string; agentId: string; topK?: number },
    ) {
      return chunks
        .filter((c) => c.organizationId === options.organizationId && c.agentId === options.agentId)
        .slice(0, options.topK ?? 5)
        .map((c) => ({ chunk: c, similarity: 0.85 }));
    },
    async deleteByDocument(documentId: string): Promise<number> {
      const before = chunks.length;
      const remaining = chunks.filter((c) => c.documentId !== documentId);
      chunks.length = 0;
      chunks.push(...remaining);
      return before - chunks.length;
    },
  };
}

describe("KnowledgeStore interface", () => {
  it("stores and retrieves chunks scoped to org + agent", async () => {
    const store = createMockStore();

    const chunk: KnowledgeChunk = {
      id: "chunk-1",
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: "We offer Botox and fillers.",
      sourceType: "document",
      embedding: new Array(1024).fill(0),
      chunkIndex: 0,
      metadata: {},
    };

    await store.store(chunk);
    const results = await store.search(new Array(1024).fill(0), {
      organizationId: "org-1",
      agentId: "lead-responder",
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.chunk.content).toBe("We offer Botox and fillers.");
    expect(results[0]?.similarity).toBeGreaterThan(0);
  });

  it("does not cross org boundaries", async () => {
    const store = createMockStore();

    await store.store({
      id: "chunk-1",
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: "Org 1 content",
      sourceType: "document",
      embedding: new Array(1024).fill(0),
      chunkIndex: 0,
      metadata: {},
    });

    const results = await store.search(new Array(1024).fill(0), {
      organizationId: "org-2",
      agentId: "lead-responder",
    });

    expect(results).toHaveLength(0);
  });

  it("deletes chunks by documentId", async () => {
    const store = createMockStore();

    await store.storeBatch([
      {
        id: "c1",
        organizationId: "org-1",
        agentId: "lead-responder",
        documentId: "doc-1",
        content: "chunk 1",
        sourceType: "document",
        embedding: new Array(1024).fill(0),
        chunkIndex: 0,
        metadata: {},
      },
      {
        id: "c2",
        organizationId: "org-1",
        agentId: "lead-responder",
        documentId: "doc-1",
        content: "chunk 2",
        sourceType: "document",
        embedding: new Array(1024).fill(0),
        chunkIndex: 1,
        metadata: {},
      },
    ]);

    const deleted = await store.deleteByDocument("doc-1");
    expect(deleted).toBe(2);
  });

  it("respects topK parameter", async () => {
    const store = createMockStore();

    for (let i = 0; i < 10; i++) {
      await store.store({
        id: `c-${i}`,
        organizationId: "org-1",
        agentId: "lead-responder",
        documentId: "doc-1",
        content: `chunk ${i}`,
        sourceType: "document",
        embedding: new Array(1024).fill(0),
        chunkIndex: i,
        metadata: {},
      });
    }

    const results = await store.search(new Array(1024).fill(0), {
      organizationId: "org-1",
      agentId: "lead-responder",
      topK: 3,
    });

    expect(results).toHaveLength(3);
  });

  it("validates source types", () => {
    const validTypes: KnowledgeSourceType[] = ["correction", "wizard", "document"];
    expect(validTypes).toHaveLength(3);
  });
});
