import { describe, it, expect } from "vitest";
import {
  DisabledEmbeddingAdapter,
  EmbeddingsUnavailableError,
} from "./disabled-embedding-adapter.js";

describe("DisabledEmbeddingAdapter", () => {
  it("reports available = false", () => {
    const adapter = new DisabledEmbeddingAdapter();
    expect(adapter.available).toBe(false);
  });

  it("has nominal dimensions = 1024", () => {
    const adapter = new DisabledEmbeddingAdapter();
    expect(adapter.dimensions).toBe(1024);
  });

  it("throws EmbeddingsUnavailableError on embed()", async () => {
    const adapter = new DisabledEmbeddingAdapter();
    await expect(adapter.embed("test")).rejects.toThrow(EmbeddingsUnavailableError);
  });

  it("throws EmbeddingsUnavailableError on embedBatch()", async () => {
    const adapter = new DisabledEmbeddingAdapter();
    await expect(adapter.embedBatch(["a", "b"])).rejects.toThrow(EmbeddingsUnavailableError);
  });
});
