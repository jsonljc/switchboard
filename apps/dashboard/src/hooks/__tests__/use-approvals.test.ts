import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useApprovals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches pending approvals", async () => {
    const approvals = [
      { id: "ap1", summary: "Pause campaign X", riskCategory: "medium", status: "pending" },
      { id: "ap2", summary: "Adjust budget Y", riskCategory: "high", status: "pending" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ approvals }),
    });

    const { useApprovals } = await import("@/hooks/use-approvals");
    const { result } = renderHook(() => useApprovals(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.approvals).toEqual(approvals);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/approvals");
  });

  it("handles fetch errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { useApprovals } = await import("@/hooks/use-approvals");
    const { result } = renderHook(() => useApprovals(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useApprovalCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no data", async () => {
    // No fetch mock — query will be pending, data will be undefined
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ approvals: [] }),
    });

    const { useApprovalCount } = await import("@/hooks/use-approvals");
    const { result } = renderHook(() => useApprovalCount(), { wrapper: createWrapper() });

    // Initially 0 (default), then still 0 after empty response
    await waitFor(() => expect(result.current).toBe(0));
  });

  it("returns count of pending approvals", async () => {
    const approvals = [
      { id: "ap1", summary: "A", riskCategory: "low", status: "pending" },
      { id: "ap2", summary: "B", riskCategory: "low", status: "pending" },
      { id: "ap3", summary: "C", riskCategory: "medium", status: "pending" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ approvals }),
    });

    const { useApprovalCount } = await import("@/hooks/use-approvals");
    const { result } = renderHook(() => useApprovalCount(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current).toBe(3));
  });
});
