import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useReviewDecision } from "../use-review-decision";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    miraFeed: { all: () => ["org", "miraFeed"], desk: () => ["org", "miraFeed", "desk"] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useReviewDecision", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs the decision to the per-draft decision endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ id: "j1", decision: "kept" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "j1", decision: "kept" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/agents/mira/creatives/j1/decision");
  });
});
