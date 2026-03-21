import { describe, it, expect, vi, beforeEach } from "vitest";
import { IngestionPipeline } from "../ingestion-pipeline.js";
import type { EmbeddingAdapter, KnowledgeStore, KnowledgeChunk } from "@switchboard/core";

function createMockEmbedding(): EmbeddingAdapter {
  return {
    dimensions: 1024,
    embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    embedBatch: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => new Array(1024).fill(0.1))),
      ),
  };
}

function createMockStore(): KnowledgeStore & { stored: KnowledgeChunk[] } {
  const stored: KnowledgeChunk[] = [];
  return {
    stored,
    store: vi.fn().mockImplementation((chunk: KnowledgeChunk) => {
      stored.push(chunk);
      return Promise.resolve();
    }),
    storeBatch: vi.fn().mockImplementation((chunks: KnowledgeChunk[]) => {
      stored.push(...chunks);
      return Promise.resolve();
    }),
    search: vi.fn().mockResolvedValue([]),
    deleteByDocument: vi.fn().mockResolvedValue(0),
  };
}

describe("IngestionPipeline", () => {
  let mockEmbedding: EmbeddingAdapter;
  let mockStore: ReturnType<typeof createMockStore>;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    mockEmbedding = createMockEmbedding();
    mockStore = createMockStore();
    pipeline = new IngestionPipeline({ embedding: mockEmbedding, store: mockStore });
  });

  it("ingests text and stores chunks with embeddings", async () => {
    const result = await pipeline.ingest({
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: "We offer Botox and fillers. Botox costs $200 per unit.",
      sourceType: "document",
    });

    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(mockStore.stored.length).toBeGreaterThan(0);
    expect(mockStore.stored[0].organizationId).toBe("org-1");
    expect(mockStore.stored[0].agentId).toBe("lead-responder");
    expect(mockStore.stored[0].sourceType).toBe("document");
    expect(mockStore.stored[0].embedding).toHaveLength(1024);
  });

  it("uses embedBatch for efficient embedding", async () => {
    // Create text long enough to produce multiple chunks
    const longText = "This is a sentence about treatments. ".repeat(200);

    await pipeline.ingest({
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: longText,
      sourceType: "document",
    });

    expect(mockEmbedding.embedBatch).toHaveBeenCalled();
  });

  it("assigns unique IDs and sequential chunk indices", async () => {
    const text = "Sentence one. ".repeat(200);

    await pipeline.ingest({
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: text,
      sourceType: "document",
    });

    const ids = new Set(mockStore.stored.map((c) => c.id));
    expect(ids.size).toBe(mockStore.stored.length); // All unique

    const indices = mockStore.stored.map((c) => c.chunkIndex);
    indices.forEach((idx, i) => expect(idx).toBe(i));
  });

  it("deletes existing chunks before re-ingestion", async () => {
    mockStore.deleteByDocument = vi.fn().mockResolvedValue(3);

    await pipeline.ingest({
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: "New content",
      sourceType: "document",
    });

    expect(mockStore.deleteByDocument).toHaveBeenCalledWith("doc-1");
  });

  it("handles empty content", async () => {
    const result = await pipeline.ingest({
      organizationId: "org-1",
      agentId: "lead-responder",
      documentId: "doc-1",
      content: "",
      sourceType: "document",
    });

    expect(result.chunksCreated).toBe(0);
  });

  it("supports all source types", async () => {
    for (const sourceType of ["correction", "wizard", "document"] as const) {
      await pipeline.ingest({
        organizationId: "org-1",
        agentId: "lead-responder",
        documentId: `doc-${sourceType}`,
        content: `Content for ${sourceType}`,
        sourceType,
      });
    }

    const types = new Set(mockStore.stored.map((c) => c.sourceType));
    expect(types).toEqual(new Set(["correction", "wizard", "document"]));
  });
});
