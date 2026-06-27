import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMiraFeed } from "../use-mira-feed";

// Shared, overridable scoped-keys mock (see use-agent-pipeline.test for rationale).
const { scopedKeysMock } = vi.hoisted(() => ({ scopedKeysMock: vi.fn() }));
vi.mock("../use-query-keys", () => ({ useScopedQueryKeys: scopedKeysMock }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  scopedKeysMock.mockReturnValue({
    miraFeed: { list: () => ["org-test", "miraFeed", "list"] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMiraFeed (live)", () => {
  it("returns the feed on 200 and hits the mira creatives URL with the limit", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobs: [],
        counts: {},
        feed: { reviewableCount: 4, renderingCount: 1 },
      }),
    });
    const { result } = renderHook(() => useMiraFeed(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.feed).toEqual({ reviewableCount: 4, renderingCount: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/mira/creatives?limit=20");
  });

  it("passes a custom limit through to the URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobs: [], counts: {}, feed: { reviewableCount: 0, renderingCount: 0 } }),
    });
    const { result } = renderHook(() => useMiraFeed(5), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/mira/creatives?limit=5");
  });

  it("surfaces isError + undefined data on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const { result } = renderHook(() => useMiraFeed(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("disables the query (no fetch) while the org scope is unresolved (keys null)", async () => {
    scopedKeysMock.mockReturnValue(null);
    const { result } = renderHook(() => useMiraFeed(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
