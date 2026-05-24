import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "../use-now";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    // Reset document.hidden to its default after each test.
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("advances on every tick", () => {
    const { result } = renderHook(() => useNow(1000));
    const initial = result.current;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBeGreaterThan(initial);
  });

  it("pauses when document.hidden is true", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const { result } = renderHook(() => useNow(1000));
    const initial = result.current;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(initial);
  });

  it("resumes ticking when visibility returns", () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const { result } = renderHook(() => useNow(1000));
    const initial = result.current;
    // Flip back to visible and dispatch the visibility event
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBeGreaterThan(initial);
  });
});
