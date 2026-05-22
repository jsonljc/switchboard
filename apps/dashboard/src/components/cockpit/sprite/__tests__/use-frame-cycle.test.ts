import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFrameCycle } from "../use-frame-cycle";
import type { AnimFrame } from "../types";

const F1: AnimFrame = { rows: ["a".repeat(24)], dur: 600 };
const F2: AnimFrame = { rows: ["b".repeat(24)], dur: 600 };

describe("useFrameCycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns null when frames is empty", () => {
    const { result } = renderHook(() => useFrameCycle([], {}));
    expect(result.current).toBeNull();
  });

  it("returns the single frame statically when frames.length === 1 (no timer scheduled)", () => {
    const { result } = renderHook(() => useFrameCycle([F1], {}));
    expect(result.current).toBe(F1.rows);
    // Advance timer beyond any plausible dur — should still be F1.
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(F1.rows);
  });

  it("cycles through frames according to each frame's dur", () => {
    const { result } = renderHook(() => useFrameCycle([F1, F2], {}));
    expect(result.current).toBe(F1.rows);
    act(() => vi.advanceTimersByTime(F1.dur));
    expect(result.current).toBe(F2.rows);
    act(() => vi.advanceTimersByTime(F2.dur));
    expect(result.current).toBe(F1.rows); // wraps
  });

  it("returns the first frame statically when playing=false (no timer)", () => {
    const { result } = renderHook(() => useFrameCycle([F1, F2], { playing: false }));
    expect(result.current).toBe(F1.rows);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(F1.rows);
  });

  it("clears the timer on unmount (no leftover callbacks)", () => {
    const { unmount } = renderHook(() => useFrameCycle([F1, F2], {}));
    unmount();
    // If timer leaked, vi would warn; advancing time after unmount is a no-op.
    act(() => vi.advanceTimersByTime(60_000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("snaps to frame[0] when playing flips to false mid-cycle (not the current idx)", () => {
    const { result, rerender } = renderHook(
      ({ playing }: { playing: boolean }) => useFrameCycle([F1, F2], { playing }),
      { initialProps: { playing: true } },
    );
    expect(result.current).toBe(F1.rows);
    // Advance to F2.
    act(() => vi.advanceTimersByTime(F1.dur));
    expect(result.current).toBe(F2.rows);
    // Now flip playing=false mid-cycle. Expect snap to F1 (frame[0]).
    rerender({ playing: false });
    expect(result.current).toBe(F1.rows);
    // Subsequent timer ticks must not change the frame (no timer running).
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(F1.rows);
  });
});
