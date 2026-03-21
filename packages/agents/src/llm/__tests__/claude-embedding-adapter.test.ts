import { describe, it, expect, vi } from "vitest";
import { ClaudeEmbeddingAdapter } from "../claude-embedding-adapter.js";

// Mock the Anthropic SDK — in real usage, the API key comes from env
const mockCreateEmbedding = vi.fn();

function createAdapter(): ClaudeEmbeddingAdapter {
  return new ClaudeEmbeddingAdapter({
    createEmbedding: mockCreateEmbedding,
  });
}

describe("ClaudeEmbeddingAdapter", () => {
  it("has 1024 dimensions", () => {
    const adapter = createAdapter();
    expect(adapter.dimensions).toBe(1024);
  });

  it("embeds a single text", async () => {
    const fakeEmbedding = new Array(1024).fill(0).map((_, i) => i * 0.001);
    mockCreateEmbedding.mockResolvedValue({
      embeddings: [fakeEmbedding],
    });

    const adapter = createAdapter();
    const result = await adapter.embed("Hello world");

    expect(result).toHaveLength(1024);
    expect(mockCreateEmbedding).toHaveBeenCalledWith({
      texts: ["Hello world"],
      model: "claude-embed-1",
    });
  });

  it("embeds a batch of texts", async () => {
    const fakeEmbeddings = [new Array(1024).fill(0.1), new Array(1024).fill(0.2)];
    mockCreateEmbedding.mockResolvedValue({
      embeddings: fakeEmbeddings,
    });

    const adapter = createAdapter();
    const results = await adapter.embedBatch(["text 1", "text 2"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(1024);
    expect(results[1]).toHaveLength(1024);
    expect(mockCreateEmbedding).toHaveBeenCalledWith({
      texts: ["text 1", "text 2"],
      model: "claude-embed-1",
    });
  });

  it("throws on API error", async () => {
    mockCreateEmbedding.mockRejectedValue(new Error("API rate limited"));

    const adapter = createAdapter();
    await expect(adapter.embed("test")).rejects.toThrow("API rate limited");
  });
});
