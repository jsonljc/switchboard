import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches alert rules and returns them", async () => {
    const rules = [
      { id: "a1", name: "High CPA", enabled: true, metricPath: "primaryKPI.current", operator: "gt", threshold: 50 },
      { id: "a2", name: "Low Spend", enabled: false, metricPath: "spend.current", operator: "lt", threshold: 10 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rules }),
    });

    // Dynamic import after mocks are set up
    const { useAlerts } = await import("@/hooks/use-alerts");
    const { result } = renderHook(() => useAlerts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(rules);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/alerts");
  });

  it("handles fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { useAlerts } = await import("@/hooks/use-alerts");
    const { result } = renderHook(() => useAlerts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useAlertHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches alert history for a given ID", async () => {
    const history = [
      { id: "h1", alertRuleId: "a1", triggeredAt: "2025-01-01T00:00:00Z", metricValue: 100, threshold: 50 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ history }),
    });

    const { useAlertHistory } = await import("@/hooks/use-alerts");
    const { result } = renderHook(() => useAlertHistory("a1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(history);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/alerts/a1/history");
  });

  it("does not fetch when id is null", async () => {
    const { useAlertHistory } = await import("@/hooks/use-alerts");
    const { result } = renderHook(() => useAlertHistory(null), { wrapper: createWrapper() });

    // Should not trigger a fetch since enabled is false
    expect(result.current.isFetching).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("useCreateAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts alert data and invalidates query cache", async () => {
    const newRule = { id: "a3", name: "Test Alert" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rule: newRule }),
    });

    const { useCreateAlert } = await import("@/hooks/use-alerts");
    const { result } = renderHook(() => useCreateAlert(), { wrapper: createWrapper() });

    result.current.mutate({
      name: "Test Alert",
      metricPath: "spend.current",
      operator: "gt",
      threshold: 100,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/alerts",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

describe("useDeleteAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends DELETE request for alert", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "a1", deleted: true }),
    });

    const { useDeleteAlert } = await import("@/hooks/use-alerts");
    const { result } = renderHook(() => useDeleteAlert(), { wrapper: createWrapper() });

    result.current.mutate("a1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/alerts/a1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
