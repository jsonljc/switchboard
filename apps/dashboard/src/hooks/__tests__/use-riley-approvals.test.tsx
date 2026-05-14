import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRileyApprovals } from "../use-riley-approvals";
import {
  pauseFixture,
  scaleFixture,
  signalHealthFixtures,
} from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures";

vi.mock("../use-recommendations", () => ({
  useRecommendations: () => ({
    data: { recommendations: [pauseFixture, scaleFixture, ...signalHealthFixtures] },
    isLoading: false,
    isError: false,
  }),
}));

function wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRileyApprovals", () => {
  it("returns view-models, not raw Recommendation rows", () => {
    const { result } = renderHook(() => useRileyApprovals(), { wrapper: wrap });
    expect(result.current.approvals).toBeDefined();
    expect(Array.isArray(result.current.approvals)).toBe(true);
    for (const v of result.current.approvals) {
      expect("kind" in v).toBe(true);
      expect("urgency" in v).toBe(true);
      expect("humanSummary" in v).toBe(false);
    }
  });

  it("collapses 3 signal-health rows + 2 single-action recs into 3 cards", () => {
    const { result } = renderHook(() => useRileyApprovals(), { wrapper: wrap });
    expect(result.current.approvals).toHaveLength(3);
  });

  it("isLoading / isError are exposed", () => {
    const { result } = renderHook(() => useRileyApprovals(), { wrapper: wrap });
    expect(typeof result.current.isLoading).toBe("boolean");
    expect(typeof result.current.isError).toBe("boolean");
  });
});
