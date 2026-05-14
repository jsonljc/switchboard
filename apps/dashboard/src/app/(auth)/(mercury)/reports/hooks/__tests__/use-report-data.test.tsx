// apps/dashboard/src/app/(auth)/reports/hooks/__tests__/use-report-data.test.tsx
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useReportData } from "../use-report-data";
import { goodFixture, problemFixture, quietFixture } from "../../fixtures";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
}));

describe("useReportData (PR-R1 fixture form)", () => {
  const originalEnv = process.env.NEXT_PUBLIC_REPORTS_LIVE;
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_REPORTS_LIVE;
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NEXT_PUBLIC_REPORTS_LIVE;
    } else {
      process.env.NEXT_PUBLIC_REPORTS_LIVE = originalEnv;
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/hooks/use-query-keys");
    vi.resetModules();
  });

  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  it("returns the THIS WEEK fixture for THIS WEEK", () => {
    const { result } = renderHook(() => useReportData("THIS WEEK"), { wrapper: createWrapper() });
    expect(result.current.data).toEqual(quietFixture);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns the THIS MONTH fixture for THIS MONTH", () => {
    const { result } = renderHook(() => useReportData("THIS MONTH"), { wrapper: createWrapper() });
    expect(result.current.data).toEqual(goodFixture);
  });

  it("returns the THIS QUARTER fixture for THIS QUARTER", () => {
    const { result } = renderHook(() => useReportData("THIS QUARTER"), {
      wrapper: createWrapper(),
    });
    expect(result.current.data).toEqual(problemFixture);
  });

  it("refresh() resolves without error in fixture form", async () => {
    const { result } = renderHook(() => useReportData("THIS MONTH"), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toEqual(goodFixture);
  });

  it("calls /api/dashboard/reports with the window param when NEXT_PUBLIC_REPORTS_LIVE='true'", async () => {
    process.env.NEXT_PUBLIC_REPORTS_LIVE = "true";
    vi.resetModules();
    vi.doMock("@/hooks/use-query-keys", () => ({
      useScopedQueryKeys: () => ({
        reports: {
          all: () => ["test-org", "reports"] as const,
          byWindow: (w: string) => ["test-org", "reports", w] as const,
        },
      }),
    }));
    const { useReportData: liveUseReportData } = await import("../use-report-data");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(goodFixture), { status: 200 }));

    const { result } = renderHook(() => liveUseReportData("THIS MONTH"), {
      wrapper: createWrapper(),
    });

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/reports?window=THIS%20MONTH");
    await waitFor(() => expect(result.current.data).toEqual(goodFixture));

    fetchMock.mockRestore();
    vi.doUnmock("@/hooks/use-query-keys");
  });

  it("surfaces fetch errors as `error` (no silent fallback to fixtures in live mode)", async () => {
    process.env.NEXT_PUBLIC_REPORTS_LIVE = "true";
    vi.resetModules();
    vi.doMock("@/hooks/use-query-keys", () => ({
      useScopedQueryKeys: () => ({
        reports: {
          all: () => ["test-org", "reports"] as const,
          byWindow: (w: string) => ["test-org", "reports", w] as const,
        },
      }),
    }));
    const { useReportData: liveUseReportData } = await import("../use-report-data");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));

    const { result } = renderHook(() => liveUseReportData("THIS MONTH"), {
      wrapper: createWrapper(),
    });

    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
      expect(result.current.data).toBeUndefined();
    });

    fetchMock.mockRestore();
    vi.doUnmock("@/hooks/use-query-keys");
  });
});
