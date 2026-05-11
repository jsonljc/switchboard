import { describe, it, expect } from "vitest";
import { splitSentences } from "../sentence-splitter.js";

describe("splitSentences", () => {
  it("splits on period, exclamation, question mark", () => {
    const result = splitSentences("First. Second! Third?");
    expect(result.length).toBe(3);
    expect(result[0]).toContain("First");
    expect(result[1]).toContain("Second");
    expect(result[2]).toContain("Third");
  });

  it("treats newlines as sentence boundaries", () => {
    const result = splitSentences("First\nSecond");
    expect(result.length).toBe(2);
    expect(result[0]).toContain("First");
    expect(result[1]).toContain("Second");
  });

  it("returns the whole text as one sentence when no punctuation", () => {
    expect(splitSentences("hello there friend")).toEqual(["hello there friend"]);
  });

  it("trims whitespace and drops empty fragments", () => {
    const result = splitSentences("  a.   b.   ");
    expect(result.length).toBe(2);
    expect(result[0]).toContain("a");
    expect(result[1]).toContain("b");
  });

  it("returns empty array for empty input", () => {
    expect(splitSentences("")).toEqual([]);
  });
});
