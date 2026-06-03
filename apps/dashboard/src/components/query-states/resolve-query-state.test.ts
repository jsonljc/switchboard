import { describe, it, expect } from "vitest";
import { resolveQueryState } from "./resolve-query-state";

describe("resolveQueryState", () => {
  it("data present, non-empty → data", () => {
    expect(resolveQueryState({ data: [1, 2], error: null })).toEqual({
      status: "data",
      data: [1, 2],
    });
  });
  it("data present but isEmpty → empty", () => {
    expect(resolveQueryState({ data: [], error: null }, (d) => d.length === 0)).toEqual({
      status: "empty",
    });
  });
  it("no data, no error → loading (keys-pending: isLoading false but pending)", () => {
    expect(resolveQueryState({ data: undefined, error: null })).toEqual({ status: "loading" });
  });
  it("no data, error → error (carries the error)", () => {
    const error = new Error("boom");
    expect(resolveQueryState({ data: undefined, error })).toEqual({ status: "error", error });
  });
  it("data present AND error → data (stale-wins)", () => {
    const error = new Error("poll failed");
    expect(resolveQueryState({ data: [1], error })).toEqual({ status: "data", data: [1] });
  });
  it("null data behaves like undefined (loading when no error)", () => {
    expect(resolveQueryState({ data: null as unknown as number[], error: null })).toEqual({
      status: "loading",
    });
  });
});
