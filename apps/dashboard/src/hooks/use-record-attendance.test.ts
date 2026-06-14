import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

// Mock session/query-keys — return a predictable scoped-key factory
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { organizationId: "org-1", user: { id: "u-1" } },
    status: "authenticated",
  })),
}));

// Mock idempotency to get deterministic keys in assertions
vi.mock("@/lib/idempotency", () => ({
  createIdempotencyKey: vi.fn(() => "test-idem-key"),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
    queryClient: qc,
  };
}

import { useRecordAttendance } from "./use-record-attendance";

describe("useRecordAttendance", () => {
  it("POSTs to /api/dashboard/bookings/:bookingId/attendance with Idempotency-Key", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecordAttendance(), { wrapper });

    act(() => {
      result.current.mutate({ bookingId: "bk-77", outcome: "attended" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/dashboard/bookings/bk-77/attendance");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("test-idem-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({
      outcome: "attended",
      recordedBy: "staff",
    });
  });

  it("throws on non-ok response so the mutation enters error state", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad" }),
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecordAttendance(), { wrapper });

    act(() => {
      result.current.mutate({ bookingId: "bk-77", outcome: "no_show" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("invalidates bookingWins.feed('alex') and reports.all() on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRecordAttendance(), { wrapper });

    act(() => {
      result.current.mutate({ bookingId: "bk-88", outcome: "attended" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // bookingWins.feed("alex") => ["org-1", "bookingWins", "feed", "alex"]
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(["org-1", "bookingWins", "feed", "alex"]),
      }),
    );
    // reports.all() => ["org-1", "reports"]
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(["org-1", "reports"]),
      }),
    );
  });

  it("does not crash when keys is null (no session/org)", async () => {
    // Override session to return no org
    const { useSession } = await import("next-auth/react");
    (useSession as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      data: null,
      status: "unauthenticated",
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRecordAttendance(), { wrapper });

    act(() => {
      result.current.mutate({ bookingId: "bk-99", outcome: "attended" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should not call invalidateQueries when keys is null
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
