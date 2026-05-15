/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOpportunitiesBoard } from "../use-opportunities-board";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    opportunities: { board: () => ["org_test", "opportunities", "board"] as const },
  }),
}));

vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: vi.fn(),
}));

import { isMercuryToolLive } from "@/lib/route-availability";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useOpportunitiesBoard", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns fixture data when the flag is off", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(false);
    const { result } = renderHook(() => useOpportunitiesBoard(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.rows.length).toBe(20));
  });

  it("fetches from the API when the flag is on", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(true);
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ rows: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof global.fetch;

    const { result } = renderHook(() => useOpportunitiesBoard(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.rows).toEqual([]));
    expect(global.fetch).toHaveBeenCalledWith("/api/dashboard/opportunities");
  });

  it("surfaces a fetch failure as isError", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(true);
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof global.fetch;

    const { result } = renderHook(() => useOpportunitiesBoard(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("validates the response against the schema and rejects malformed payloads", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(true);
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ rows: [{ id: "bad" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof global.fetch;

    const { result } = renderHook(() => useOpportunitiesBoard(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
