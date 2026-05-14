import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRileyActivity } from "../use-riley-activity";
import {
  pausedFixture,
  watchingFixture,
} from "@/lib/cockpit/riley/__fixtures__/riley-activity-fixtures";

// Avoid SessionProvider requirement from useScopedQueryKeys → useSession
vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => null,
  useTenantContext: () => null,
}));

const connState = {
  rows: [{ serviceId: "meta-ads", status: "connected" }] as unknown[],
  isLoading: false,
};
vi.mock("../use-connections", () => ({
  useConnections: () => ({
    data: { connections: connState.rows },
    isLoading: connState.isLoading,
    isError: false,
  }),
}));

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({
      data: { actions: [pausedFixture, watchingFixture], roster: [], states: [] },
      isLoading: false,
      isError: false,
    }),
  };
});

function wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRileyActivity", () => {
  it("returns ActivityRow[] when Meta Ads is connected", () => {
    const { result } = renderHook(() => useRileyActivity(), { wrapper: wrap });
    expect(result.current.rows.length).toBeGreaterThanOrEqual(2);
    for (const r of result.current.rows) {
      expect("kind" in r).toBe(true);
      expect("head" in r).toBe(true);
    }
  });

  it("returns 3 cold-state synthetic rows when no Meta connection", () => {
    connState.rows = [];
    const { result } = renderHook(() => useRileyActivity(), { wrapper: wrap });
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.rows[0].head).toMatch(/Connect Meta Ads/i);
    connState.rows = [{ serviceId: "meta-ads", status: "connected" }];
  });

  it("holds empty + isLoading=true while connections are still loading (no cold-state flash)", () => {
    connState.isLoading = true;
    const { result } = renderHook(() => useRileyActivity(), { wrapper: wrap });
    expect(result.current.rows).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    connState.isLoading = false;
  });
});
