import { describe, it, expect, vi, beforeEach } from "vitest";
import { KnowledgeRetriever, computeConfidence } from "../retrieval.js";
import { DisabledEmbeddingAdapter } from "../../llm/disabled-embedding-adapter.js";
import type { EmbeddingAdapter, KnowledgeStore, RetrievalResult } from "@switchboard/core";

function createMockEmbedding(): EmbeddingAdapter {
  return {
    dimensions: 1024,
    available: true,
    embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([]),
  };
}

function createMockStore(results: RetrievalResult[] = []): KnowledgeStore {
  return {
    store: vi.fn(),
    storeBatch: vi.fn(),
    search: vi.fn().mockResolvedValue(results),
    deleteByDocument: vi.fn(),
  };
}

describe("KnowledgeRetriever", () => {
  let mockEmbedding: EmbeddingAdapter;

  beforeEach(() => {
    mockEmbedding = createMockEmbedding();
  });

  it("retrieves and sorts by boosted score", async () => {
    const mockStore = createMockStore([
      {
        chunk: {
          id: "c1",
          organizationId: "org-1",
          agentId: "lr",
          documentId: "d1",
          content: "doc content",
          sourceType: "document",
          embedding: [],
          chunkIndex: 0,
          metadata: {},
        },
        similarity: 0.9,
      },
      {
        chunk: {
          id: "c2",
          organizationId: "org-1",
          agentId: "lr",
          documentId: "d2",
          content: "correction content",
          sourceType: "correction",
          embedding: [],
          chunkIndex: 0,
          metadata: {},
        },
        similarity: 0.85,
      },
    ]);

    const retriever = new KnowledgeRetriever({
      embedding: mockEmbedding,
      store: mockStore,
    });

    const results = await retriever.retrieve("question", {
      organizationId: "org-1",
      agentId: "lr",
    });

    // Correction (0.85 * 1.3 = 1.105) should rank above document (0.90 * 1.0)
    expect(results[0]?.sourceType).toBe("correction");
    expect(results[1]?.sourceType).toBe("document");
  });

  it("applies source-type boost factors", async () => {
    const mockStore = createMockStore([
      {
        chunk: {
          id: "c1",
          organizationId: "org-1",
          agentId: "lr",
          documentId: "d1",
          content: "wizard content",
          sourceType: "wizard",
          embedding: [],
          chunkIndex: 0,
          metadata: {},
        },
        similarity: 0.8,
      },
    ]);

    const retriever = new KnowledgeRetriever({
      embedding: mockEmbedding,
      store: mockStore,
    });

    const results = await retriever.retrieve("q", {
      organizationId: "org-1",
      agentId: "lr",
    });

    // Wizard boost: 0.80 * 1.15 = 0.92
    expect(results[0]?.similarity).toBeCloseTo(0.92, 1);
  });

  it("returns empty array when no chunks found", async () => {
    const mockStore = createMockStore([]);
    const retriever = new KnowledgeRetriever({
      embedding: mockEmbedding,
      store: mockStore,
    });

    const results = await retriever.retrieve("q", {
      organizationId: "org-1",
      agentId: "lr",
    });

    expect(results).toHaveLength(0);
  });

  it("passes topK to store", async () => {
    const mockStore = createMockStore([]);
    const retriever = new KnowledgeRetriever({
      embedding: mockEmbedding,
      store: mockStore,
      topK: 10,
    });

    await retriever.retrieve("q", { organizationId: "org-1", agentId: "lr" });

    expect(mockStore.search).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: 10 }),
    );
  });
});

describe("KnowledgeRetriever — unavailable embeddings", () => {
  it("returns empty results when adapter is unavailable", async () => {
    const adapter = new DisabledEmbeddingAdapter();
    const mockStore = createMockStore([]);
    const retriever = new KnowledgeRetriever({ embedding: adapter, store: mockStore });
    const result = await retriever.retrieve("test query", {
      organizationId: "org1",
      agentId: "agent1",
    });
    expect(result).toEqual([]);
    expect(mockStore.search).not.toHaveBeenCalled();
  });
});

describe("computeConfidence", () => {
  it("returns min of retrieval and LLM confidence", () => {
    expect(computeConfidence({ bestSimilarity: 0.9, llmSelfReport: 0.8 })).toBe(0.8);
    expect(computeConfidence({ bestSimilarity: 0.7, llmSelfReport: 0.9 })).toBe(0.7);
  });

  it("caps confidence at 0.4 when best similarity is below retrieval threshold", () => {
    // Default retrievalThreshold is 0.7
    const result = computeConfidence({
      bestSimilarity: 0.5,
      llmSelfReport: 0.95,
    });
    expect(result).toBe(0.4);
  });

  it("caps at 0.4 even when LLM reports lower", () => {
    const result = computeConfidence({
      bestSimilarity: 0.5,
      llmSelfReport: 0.3,
    });
    expect(result).toBe(0.3);
  });

  it("returns 0 when no chunks were retrieved", () => {
    expect(computeConfidence({ bestSimilarity: 0, llmSelfReport: 0.9 })).toBe(0);
  });

  it("accepts custom retrieval threshold", () => {
    // With higher threshold, even 0.75 similarity triggers the cap
    const result = computeConfidence({
      bestSimilarity: 0.75,
      llmSelfReport: 0.9,
      retrievalThreshold: 0.8,
    });
    expect(result).toBe(0.4);
  });
});
