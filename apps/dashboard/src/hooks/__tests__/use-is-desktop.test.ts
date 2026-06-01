import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsDesktop } from "../use-is-desktop";

// jsdom has no matchMedia — we provide a minimal stub per test.

type MatchMediaCallback = (e: MediaQueryListEvent) => void;

function makeMockMq(matches: boolean) {
  const listeners: MatchMediaCallback[] = [];
  const mq = {
    matches,
    addEventListener(_type: string, fn: MatchMediaCallback) {
      listeners.push(fn);
    },
    removeEventListener(_type: string, fn: MatchMediaCallback) {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    /** Test helper — fire a change event */
    _fire(newMatches: boolean) {
      listeners.forEach((fn) => fn({ matches: newMatches } as MediaQueryListEvent));
    },
  };
  return mq;
}

describe("useIsDesktop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false before hydration (no matchMedia)", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });

  it("returns false when viewport is narrow (< 1024px)", () => {
    const mq = makeMockMq(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq),
    );
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });

  it("returns true when viewport is wide (≥ 1024px)", () => {
    const mq = makeMockMq(true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq),
    );
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("updates reactively on viewport change", () => {
    const mq = makeMockMq(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq),
    );
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    act(() => mq._fire(true));
    expect(result.current).toBe(true);
    act(() => mq._fire(false));
    expect(result.current).toBe(false);
  });

  it("removes the change listener on unmount", () => {
    const mq = makeMockMq(true);
    const removeEventListener = vi.spyOn(mq, "removeEventListener");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq),
    );
    const { unmount } = renderHook(() => useIsDesktop());
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
