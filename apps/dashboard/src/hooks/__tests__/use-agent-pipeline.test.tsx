import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgentPipeline } from "../use-agent-pipeline";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: vi.fn(() => ({
    pipeline: { feed: (a: string) => ["org-A", "pipeline", "feed", a] },
  })),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useAgentPipeline", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("fetches /api/dashboard/agents/:agentKey/pipeline and returns the vm", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        vm: { agentKey: "alex", tiles: [], totalCount: 0 },
      }),
    });

    const { result } = renderHook(() => useAgentPipeline("alex"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/pipeline");
    expect(result.current.data?.agentKey).toBe("alex");
    expect(result.current.isError).toBe(false);
  });

  it("surfaces a fetch error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useAgentPipeline("alex"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("HTTP 500");
  });
});
