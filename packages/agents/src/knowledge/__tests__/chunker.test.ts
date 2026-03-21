import { describe, it, expect } from "vitest";
import { chunkText } from "../chunker.js";

describe("chunkText", () => {
  it("returns the full text as a single chunk when under limit", () => {
    const result = chunkText("Short text.", { maxTokens: 500 });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Short text.");
    expect(result[0].index).toBe(0);
  });

  it("splits long text into multiple chunks", () => {
    // Create text that's ~2000 tokens (8000 chars)
    const longText = "This is a sentence. ".repeat(400);
    const result = chunkText(longText, { maxTokens: 500 });
    expect(result.length).toBeGreaterThan(1);

    // Every chunk should be under the max
    for (const chunk of result) {
      expect(chunk.content.length / 4).toBeLessThanOrEqual(550); // small tolerance
    }
  });

  it("preserves paragraph boundaries when possible", () => {
    const text =
      "Paragraph one content here.\n\nParagraph two content here.\n\nParagraph three content here.";
    const result = chunkText(text, { maxTokens: 500 });
    // Short enough to be one chunk
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("Paragraph one");
  });

  it("produces overlapping chunks", () => {
    const sentences = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}.`);
    const text = sentences.join(" ");
    const result = chunkText(text, { maxTokens: 100, overlapTokens: 20 });

    expect(result.length).toBeGreaterThan(1);

    // Check overlap: end of chunk N should appear at start of chunk N+1
    for (let i = 0; i < result.length - 1; i++) {
      const currentEnd = result[i].content.slice(-40);
      const nextStart = result[i + 1].content.slice(0, 100);
      // At least some overlap should exist
      const overlapWords = currentEnd.split(/\s+/).filter((w) => nextStart.includes(w));
      expect(overlapWords.length).toBeGreaterThan(0);
    }
  });

  it("assigns sequential chunk indices", () => {
    const text = "Word. ".repeat(1000);
    const result = chunkText(text, { maxTokens: 100 });
    result.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it("handles empty text", () => {
    const result = chunkText("", { maxTokens: 500 });
    expect(result).toHaveLength(0);
  });

  it("uses default options when none provided", () => {
    const text = "Hello world.";
    const result = chunkText(text);
    expect(result).toHaveLength(1);
  });
});
