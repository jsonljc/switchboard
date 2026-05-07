import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgentMetrics } from "../use-agent-metrics";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: vi.fn(() => ({
    metrics: {
      feed: (agentKey: string, window: string) => ["org-test", "metrics", "feed", agentKey, window],
    },
  })),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAgentMetrics (live)", () => {
  it("returns vm on 200", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vm: { hero: { kind: "tours-booked", value: 1 }, folioRange: "Mon" } }),
    });
    const { result } = renderHook(() => useAgentMetrics("alex" as never), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.folioRange).toBe("Mon");
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/metrics?window=week");
  });

  it("returns isError on 500", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useAgentMetrics("alex" as never), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
