import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgentWins } from "../use-agent-wins";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    wins: {
      feed: (agentKey: string, window: string) => ["org-A", "wins", "feed", agentKey, window],
      byAgent: (agentKey: string) => ["org-A", "wins", "feed", agentKey],
      all: () => ["org-A", "wins"],
    },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useAgentWins (live)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("returns vm on 200 happy path", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          vm: {
            wins: [{ id: "r1" }],
            hasMore: false,
            freshness: {
              generatedAt: "2026-05-07T06:30:00.000Z",
              window: "today",
              dataSource: "live",
            },
          },
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper });
    await waitFor(() => expect(result.current.data?.wins).toHaveLength(1));
    expect(result.current.isError).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/agents/alex/wins?window=today"),
    );
  });

  it("surfaces isError on non-200", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("uses the window parameter when supplied", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          vm: {
            wins: [],
            hasMore: false,
            freshness: { generatedAt: "x", window: "week", dataSource: "live" },
          },
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useAgentWins("alex", "week"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/agents/alex/wins?window=week"),
    );
  });
});
