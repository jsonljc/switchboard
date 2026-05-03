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

describe("useShadowActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches from /api/dashboard/recommendations?surface=shadow_action&status=pending&since=24h", async () => {
    const shadowActions = [
      { id: "s-1", undoableUntil: new Date(Date.now() + 3600_000).toISOString() },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ recommendations: shadowActions }),
    });

    const { useShadowActions } = await import("@/hooks/use-shadow-actions.js");
    const { result } = renderHook(() => useShadowActions(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.recommendations).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/recommendations?surface=shadow_action&status=pending&since=24h",
    );
  });
});
