import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCopier } from "../use-copier.js";

describe("useCopier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("starts with copied=null", () => {
    const { result } = renderHook(() => useCopier());
    expect(result.current[0]).toBeNull();
  });

  it("sets copied=<key> when clipboard write succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useCopier());
    await act(async () => {
      result.current[1]("entryHash", "abc123");
    });
    expect(writeText).toHaveBeenCalledWith("abc123");
    expect(result.current[0]).toBe("entryHash");
  });

  it("clears copied after 1100ms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopier());
    await act(async () => {
      result.current[1]("entryHash", "abc123");
    });
    expect(result.current[0]).toBe("entryHash");
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current[0]).toBeNull();
  });

  it("does NOT throw when navigator.clipboard is missing (H4)", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopier());
    expect(() => {
      act(() => {
        result.current[1]("entryHash", "abc123");
      });
    }).not.toThrow();
    // Visual feedback still flips so the user sees acknowledgement.
    expect(result.current[0]).toBe("entryHash");
  });

  it("does NOT throw when clipboard.writeText rejects (H4)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useCopier());
    await act(async () => {
      result.current[1]("entryHash", "abc123");
    });
    expect(result.current[0]).toBe("entryHash");
  });
});
