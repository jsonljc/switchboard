import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
  afterEach(() => vi.unstubAllGlobals());

  it("treats 409 (already decided) as silent success, like the inbox commit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 409 })));
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    result.current.mutate({ id: "job1", decision: "kept" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: "job1", decision: "kept", silent: true });
  });

  it("still throws on real failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    result.current.mutate({ id: "job1", decision: "kept" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("returns the server payload on plain success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "job1", decision: "kept" }), { status: 200 }),
        ),
    );
    const { result } = renderHook(() => useReviewDecision(), { wrapper });
    result.current.mutate({ id: "job1", decision: "kept" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: "job1", decision: "kept" });
    expect(result.current.data?.silent).toBeUndefined();
  });
});
