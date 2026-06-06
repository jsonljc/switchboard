// apps/dashboard/src/app/(auth)/reports/hooks/__tests__/use-paid-visits.test.tsx
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePaidVisits } from "../use-paid-visits";
import { PAID_VISITS_FIXTURE } from "../../fixtures";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => null,
}));

// isMercuryToolLive defaults to false (no NEXT_PUBLIC_REPORTS_LIVE env), so
// the fixture path is always exercised without network calls.
vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("usePaidVisits (fixture mode)", () => {
  it("returns the 3 PAID_VISITS_FIXTURE rows in fixture mode", () => {
    const { result } = renderHook(() => usePaidVisits("THIS MONTH"), {
      wrapper: createWrapper(),
    });
    expect(result.current.paidVisits).toEqual(PAID_VISITS_FIXTURE);
    expect(result.current.paidVisits).toHaveLength(3);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fixture rows have the expected attribution bases", () => {
    const { result } = renderHook(() => usePaidVisits("THIS WEEK"), {
      wrapper: createWrapper(),
    });
    const bases = result.current.paidVisits?.map((v) => v.attributionBasis);
    expect(bases).toContain("ctwa_captured");
    expect(bases).toContain("campaign_missing");
  });

  it("fixture rows have amountMajor in dollars (not cents)", () => {
    const { result } = renderHook(() => usePaidVisits("THIS QUARTER"), {
      wrapper: createWrapper(),
    });
    // All fixture amounts are <1000 (dollars, not cents which would be >10000)
    result.current.paidVisits?.forEach((v) => {
      expect(v.amountMajor).toBeLessThan(1000);
    });
  });

  it("the hook is callable with any ReportWindow variant", () => {
    for (const w of ["THIS WEEK", "THIS MONTH", "THIS QUARTER"] as const) {
      const { result } = renderHook(() => usePaidVisits(w), { wrapper: createWrapper() });
      expect(result.current.paidVisits).toBeDefined();
    }
  });
});
