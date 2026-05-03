import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches from /api/dashboard/recommendations?surface=queue&status=pending", async () => {
    const recommendations = [{ id: "r-1" }, { id: "r-2" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations }),
    });

    const { useRecommendations } = await import("@/hooks/use-recommendations.js");
    const { result } = renderHook(() => useRecommendations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.recommendations).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/recommendations?surface=queue&status=pending",
    );
  });
});

describe("useRecommendationCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the row count", async () => {
    const recommendations = [{ id: "r-1" }, { id: "r-2" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations }),
    });

    const { useRecommendationCount } = await import("@/hooks/use-recommendations.js");
    const { result } = renderHook(() => useRecommendationCount(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current).toBe(2));
  });
});
