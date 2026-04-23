import { describe, it, expect } from "vitest";
import type { EmbeddingAdapter } from "../embedding-adapter.js";

describe("EmbeddingAdapter interface", () => {
  it("can be implemented with a mock adapter", async () => {
    const adapter: EmbeddingAdapter = {
      dimensions: 1024,
      available: true,
      async embed(_text: string): Promise<number[]> {
        return new Array(1024).fill(0).map(() => Math.random());
      },
      async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.map(() => new Array(1024).fill(0).map(() => Math.random()));
      },
    };

    const result = await adapter.embed("hello");
    expect(result).toHaveLength(1024);

    const batchResult = await adapter.embedBatch(["a", "b"]);
    expect(batchResult).toHaveLength(2);
    expect(batchResult[0]).toHaveLength(1024);

    expect(adapter.dimensions).toBe(1024);
  });
});
