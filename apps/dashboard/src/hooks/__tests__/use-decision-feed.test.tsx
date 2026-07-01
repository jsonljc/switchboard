import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDecisionFeed } from "../use-decision-feed";

// Shared, overridable scoped-keys mock (see use-agent-pipeline.test for rationale).
const { scopedKeysMock } = vi.hoisted(() => ({ scopedKeysMock: vi.fn() }));
// use-decision-feed imports via the "@/hooks/use-query-keys" alias.
vi.mock("@/hooks/use-query-keys", () => ({ useScopedQueryKeys: scopedKeysMock }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  scopedKeysMock.mockReturnValue({
    decisions: {
      feed: (agentKey: string | null) => ["org-test", "decisions", "feed", agentKey ?? "all"],
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDecisionFeed (live)", () => {
  it("returns the decision feed on 200 and hits the all-agents URL when agentKey is null", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ decisions: [], counts: { total: 3, approval: 2, handoff: 1 } }),
    });
    const { result } = renderHook(() => useDecisionFeed(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.counts).toEqual({ total: 3, approval: 2, handoff: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/decisions");
  });

  it("scopes the URL to the agent when an agentKey is given", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ decisions: [], counts: { total: 0, approval: 0, handoff: 0 } }),
    });
    const { result } = renderHook(() => useDecisionFeed("alex"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/decisions");
  });

  it("surfaces isError on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const { result } = renderHook(() => useDecisionFeed(null), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("disables the query (no fetch) while the org scope is unresolved (keys null)", async () => {
    scopedKeysMock.mockReturnValue(null);
    const { result } = renderHook(() => useDecisionFeed(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
