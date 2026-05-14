import { describe, it, expect } from "vitest";
import { jsonDiff } from "../json-diff";

describe("jsonDiff", () => {
  it("returns empty for identical objects", () => {
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });
  it("returns changed keys for top-level value diff", () => {
    expect(jsonDiff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(["b"]);
  });
  it("returns added keys", () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
  });
  it("returns removed keys", () => {
    expect(jsonDiff({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
  });
  it("compares nested objects by JSON serialization", () => {
    expect(jsonDiff({ a: { x: 1 } }, { a: { x: 2 } })).toEqual(["a"]);
  });
});
