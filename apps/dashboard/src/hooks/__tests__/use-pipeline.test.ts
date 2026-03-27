import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { usePipeline } from "../use-pipeline";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const MOCK_RESPONSE = {
  organizationId: "org-1",
  stages: [{ stage: "interested", count: 5, totalValue: 100000 }],
  totalContacts: 5,
  totalRevenue: 100000,
  generatedAt: "2026-03-27T00:00:00Z",
};

describe("usePipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches from /api/dashboard/pipeline", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => usePipeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/pipeline");
    expect(result.current.data?.totalRevenue).toBe(100000);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { result } = renderHook(() => usePipeline(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
