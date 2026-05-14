import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRileyStatus } from "../use-riley-status";
import { pauseFixture } from "@/lib/cockpit/riley/__fixtures__/riley-recommendation-fixtures";

const haltState = { halted: false };
vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => ({ halted: haltState.halted, setHalted: () => {}, toggleHalt: () => {} }),
}));

const connectionsState = { rows: [{ serviceId: "meta-ads", status: "connected" }] as unknown[] };
vi.mock("../use-connections", () => ({
  useConnections: () => ({
    data: { connections: connectionsState.rows },
    isLoading: false,
    isError: false,
  }),
}));

const recsState = { rows: [pauseFixture] as unknown[] };
vi.mock("../use-recommendations", () => ({
  useRecommendations: () => ({
    data: { recommendations: recsState.rows },
    isLoading: false,
    isError: false,
  }),
}));

const activityState = { lastAt: new Date("2026-05-14T11:59:00.000Z") };
vi.mock("../use-agent-activity", () => ({
  useAgentActivity: () => ({
    data: {
      actions: [{ agentRole: "riley", timestamp: activityState.lastAt.toISOString() }],
      roster: [],
      states: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

// Pin "now" to 1 minute after the activity fixture so WATCHING window check passes
vi.mock("@/app/(auth)/(mercury)/approvals/hooks/use-now", () => ({
  useNow: () => new Date("2026-05-14T12:00:00.000Z").getTime(),
}));

function wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRileyStatus", () => {
  it("HALTED when useHalt().halted is true", () => {
    haltState.halted = true;
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("HALTED");
    haltState.halted = false;
  });

  it("IDLE when no Meta Ads Connection (even with pending recs)", () => {
    connectionsState.rows = [];
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("IDLE");
    connectionsState.rows = [{ serviceId: "meta-ads", status: "connected" }];
  });

  it("WAITING with Connection + pending recs", () => {
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("WAITING");
  });

  it("WATCHING when Connection + no pending recs + recent activity", () => {
    recsState.rows = [];
    const { result } = renderHook(() => useRileyStatus(), { wrapper: wrap });
    expect(result.current).toBe("WATCHING");
    recsState.rows = [pauseFixture];
  });
});
