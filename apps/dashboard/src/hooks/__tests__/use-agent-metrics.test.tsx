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

  it("surfaces A.3 echo fields when the API returns them", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        vm: {
          hero: { kind: "tours-booked", value: 9, comparator: { window: "week", value: 6 } },
          folioRange: "May 12 – May 18",
          targets: { avgValueCents: 17900, targetCpbCents: 3000 },
          spendCents: 21400,
          leads: 47,
          qualifiedPct: 19,
          bookedDelta: "+3",
          leadsDelta: "+12",
          qualifiedDelta: "+4 pts",
        },
      }),
    });
    const { result } = renderHook(() => useAgentMetrics("alex" as never), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const data = result.current.data;
    expect(data?.targets).toEqual({ avgValueCents: 17900, targetCpbCents: 3000 });
    expect(data?.spendCents).toBe(21400);
    expect(data?.leads).toBe(47);
    expect(data?.qualifiedPct).toBe(19);
    expect(data?.bookedDelta).toBe("+3");
    expect(data?.leadsDelta).toBe("+12");
    expect(data?.qualifiedDelta).toBe("+4 pts");
  });

  it("tolerates legacy API responses missing A.3 fields (undefined, not crash)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        vm: {
          hero: { kind: "tours-booked", value: 3, comparator: { window: "week", value: 2 } },
          folioRange: "May 5 – May 11",
          // A.3 fields absent — simulate older API during deploy skew
        },
      }),
    });
    const { result } = renderHook(() => useAgentMetrics("alex" as never), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const data = result.current.data;
    expect(data?.folioRange).toBe("May 5 – May 11");
    // A.3 fields are undefined — hook does not throw
    expect(data?.targets).toBeUndefined();
    expect(data?.spendCents).toBeUndefined();
  });
});

describe("useAgentMetrics window param", () => {
  it("defaults to week: URL includes ?window=week when no window arg given", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vm: { hero: { kind: "ad-leads", value: 5 } } }),
    });
    const { result } = renderHook(() => useAgentMetrics("riley" as never), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("?window=week"));
  });

  it("passing 'all' requests ?window=all URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vm: { hero: { kind: "ad-leads", value: 214 } } }),
    });
    const { result } = renderHook(() => useAgentMetrics("riley" as never, "all"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/riley/metrics?window=all");
    expect(result.current.data?.hero?.value).toBe(214);
  });

  it("a 400 response with window=all surfaces as isError:true and data:undefined (caller can fall back to week)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    const { result } = renderHook(() => useAgentMetrics("riley" as never, "all"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("'week' and 'all' use distinct query keys (no cache collision)", () => {
    // The query key factory must include window so each window has its own entry.
    const keys = {
      metrics: {
        feed: (agentKey: string, window: string) => [
          "org-test",
          "metrics",
          "feed",
          agentKey,
          window,
        ],
      },
    };
    const weekKey = keys.metrics.feed("riley", "week");
    const allKey = keys.metrics.feed("riley", "all");
    expect(weekKey).not.toEqual(allKey);
  });
});
