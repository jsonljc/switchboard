/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PipelineBoardResponse } from "@switchboard/schemas";
import { useOpportunityStageTransition } from "../use-opportunity-stage-transition";

const KEY = ["org_test", "opportunities", "board"] as const;
const SEED: PipelineBoardResponse = {
  rows: [
    {
      id: "opp_001",
      contactId: "c_001",
      serviceId: "svc_1",
      serviceName: "Test service",
      stage: "interested",
      timeline: "exploring",
      priceReadiness: "unknown",
      objections: [],
      qualificationComplete: false,
      estimatedValue: 1000,
      revenueTotal: 0,
      assignedAgent: null,
      assignedStaff: null,
      lostReason: null,
      notes: null,
      openedAt: "2026-05-13T01:00:00.000Z",
      updatedAt: "2026-05-13T02:00:00.000Z",
      closedAt: null,
      contact: { id: "c_001", name: "Test", primaryChannel: "whatsapp" },
    },
  ],
};

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    opportunities: { board: () => KEY },
  }),
}));

vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: vi.fn(),
}));

import { isMercuryToolLive } from "@/lib/route-availability";

function buildHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(KEY, SEED);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useOpportunityStageTransition", () => {
  const originalFetch = global.fetch;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("optimistically updates the cache on mutate (fixture mode)", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(false);
    const { qc, wrapper } = buildHarness();
    const { result } = renderHook(() => useOpportunityStageTransition(), { wrapper });

    act(() => {
      result.current.mutate({ id: "opp_001", stage: "qualified" });
    });

    // onMutate awaits cancelQueries; the cache write resolves in a microtask.
    await waitFor(() => {
      const optimistic = qc.getQueryData<PipelineBoardResponse>(KEY);
      expect(optimistic?.rows[0].stage).toBe("qualified");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("sets closedAt on transition to a terminal stage", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(false);
    const { qc, wrapper } = buildHarness();
    const { result } = renderHook(() => useOpportunityStageTransition(), { wrapper });

    act(() => {
      result.current.mutate({ id: "opp_001", stage: "won" });
    });

    await waitFor(() => {
      const optimistic = qc.getQueryData<PipelineBoardResponse>(KEY);
      expect(optimistic?.rows[0].stage).toBe("won");
      expect(optimistic?.rows[0].closedAt).not.toBeNull();
    });
  });

  it("clears closedAt when leaving a terminal stage", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(false);
    const { qc, wrapper } = buildHarness();
    qc.setQueryData<PipelineBoardResponse>(KEY, {
      rows: SEED.rows.map((r) => ({ ...r, stage: "lost", closedAt: "2026-05-10T00:00:00.000Z" })),
    });
    const { result } = renderHook(() => useOpportunityStageTransition(), { wrapper });

    act(() => {
      result.current.mutate({ id: "opp_001", stage: "interested" });
    });

    await waitFor(() => {
      const optimistic = qc.getQueryData<PipelineBoardResponse>(KEY);
      expect(optimistic?.rows[0].closedAt).toBeNull();
    });
  });

  it("does NOT invalidate the cache after a fixture-mode mutation (preserves optimistic write)", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(false);
    const { qc, wrapper } = buildHarness();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useOpportunityStageTransition(), { wrapper });

    act(() => {
      result.current.mutate({ id: "opp_001", stage: "qualified" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: KEY }));
    // The optimistically-written row should still be present.
    const after = qc.getQueryData<PipelineBoardResponse>(KEY);
    expect(after?.rows[0].stage).toBe("qualified");
  });

  it("rolls back the cache when the live mutation fails", async () => {
    vi.mocked(isMercuryToolLive).mockReturnValue(true);
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof global.fetch;

    const { qc, wrapper } = buildHarness();
    const { result } = renderHook(() => useOpportunityStageTransition(), { wrapper });

    act(() => {
      result.current.mutate({ id: "opp_001", stage: "qualified" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const after = qc.getQueryData<PipelineBoardResponse>(KEY);
    expect(after?.rows[0].stage).toBe("interested");
  });
});
