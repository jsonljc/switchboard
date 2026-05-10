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

  it("when NEXT_PUBLIC_REPORTS_LIVE is 'true', the hook still returns fixture in PR-R1", () => {
    process.env.NEXT_PUBLIC_REPORTS_LIVE = "true";
    const { result } = renderHook(() => useReportData("THIS MONTH"), { wrapper: createWrapper() });
    expect(result.current.data).toEqual(goodFixture);
  });
});
