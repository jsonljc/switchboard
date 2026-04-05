import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollReveal } from "../use-scroll-reveal";

const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((_callback: IntersectionObserverCallback) => ({
      observe: mockObserve,
      disconnect: mockDisconnect,
      unobserve: vi.fn(),
    })),
  );
});

describe("useScrollReveal", () => {
  it("returns a ref and isVisible defaults to false", () => {
    const { result } = renderHook(() => useScrollReveal());
    expect(result.current.isVisible).toBe(false);
    expect(result.current.ref).toBeDefined();
  });

  it("calls IntersectionObserver with correct threshold", () => {
    renderHook(() => useScrollReveal({ threshold: 0.3 }));
    expect(IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ threshold: 0.3 }),
    );
  });
});
