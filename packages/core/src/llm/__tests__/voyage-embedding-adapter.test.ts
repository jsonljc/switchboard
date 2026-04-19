import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoyageEmbeddingAdapter } from "../voyage-embedding-adapter.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createAdapter(): VoyageEmbeddingAdapter {
  return new VoyageEmbeddingAdapter({ apiKey: "test-key" });
}

describe("VoyageEmbeddingAdapter", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has 1024 dimensions", () => {
    expect(createAdapter().dimensions).toBe(1024);
  });

  it("embeds a single text via Voyage API", async () => {
    const fakeEmbedding = new Array(1024).fill(0).map((_, i) => i * 0.001);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: fakeEmbedding }] }),
    });

    const result = await createAdapter().embed("Hello world");

    expect(result).toHaveLength(1024);
    expect(mockFetch).toHaveBeenCalledWith("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({
        input: ["Hello world"],
        model: "voyage-3-large",
      }),
    });
  });

  it("embeds a batch of texts", async () => {
    const fakeEmbeddings = [new Array(1024).fill(0.1), new Array(1024).fill(0.2)];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: fakeEmbeddings.map((e) => ({ embedding: e })),
      }),
    });

    const results = await createAdapter().embedBatch(["text 1", "text 2"]);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(1024);
    expect(results[1]).toHaveLength(1024);
  });

  it("uses custom model when provided", async () => {
    const adapter = new VoyageEmbeddingAdapter({
      apiKey: "test-key",
      model: "voyage-3-lite",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1024).fill(0) }] }),
    });

    await adapter.embed("test");

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.model).toBe("voyage-3-lite");
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    });

    await expect(createAdapter().embed("test")).rejects.toThrow(
      "Voyage API error 429: rate limited",
    );
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network unreachable"));

    await expect(createAdapter().embed("test")).rejects.toThrow("Network unreachable");
  });
});
