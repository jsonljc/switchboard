import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEntrancePlayed } from "../use-entrance-played";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("useEntrancePlayed", () => {
  it("returns hasPlayed=false on first mount", () => {
    const { result } = renderHook(() => useEntrancePlayed());
    expect(result.current.hasPlayed).toBe(false);
  });

  it("sets hasPlayed=true after markPlayed is called", () => {
    const { result } = renderHook(() => useEntrancePlayed());
    act(() => result.current.markPlayed());
    expect(result.current.hasPlayed).toBe(true);
  });

  it("persists across remounts via sessionStorage", () => {
    const { result, unmount } = renderHook(() => useEntrancePlayed());
    act(() => result.current.markPlayed());
    unmount();
    const { result: result2 } = renderHook(() => useEntrancePlayed());
    expect(result2.current.hasPlayed).toBe(true);
  });

  it("resets when sessionStorage is cleared", () => {
    const { result, unmount } = renderHook(() => useEntrancePlayed());
    act(() => result.current.markPlayed());
    unmount();
    sessionStorage.clear();
    const { result: result2 } = renderHook(() => useEntrancePlayed());
    expect(result2.current.hasPlayed).toBe(false);
  });
});
