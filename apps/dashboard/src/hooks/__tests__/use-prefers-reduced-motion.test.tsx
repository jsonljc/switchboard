import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe("usePrefersReducedMotion", () => {
  it("reads the OS preference after mount", async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("defaults to false when motion is allowed", async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));
  });
});
