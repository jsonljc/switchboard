import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateCreativeDraftRequest } from "../use-create-creative-draft-request";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    miraFeed: { desk: () => ["org", "miraFeed", "desk"], all: () => ["org", "miraFeed"] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCreateCreativeDraftRequest", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends an Idempotency-Key header and returns the submitted contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        jobId: "j1",
        status: "brief_submitted",
        expectedDraftCount: 1,
        cost: { upfront: null, generationGatedInReview: true },
        requestSource: "mira.open_brief",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCreateCreativeDraftRequest(), { wrapper });
    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        promoting: "Botox",
        goal: "more_bookings",
        vibe: "warm",
        mode: "polished",
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(outcome).toEqual({ pendingApproval: false, jobId: "j1" });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("surfaces a PENDING_APPROVAL (202) upstream as a parked state, not a draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        outcome: "PENDING_APPROVAL",
        workUnitId: "wu1",
        traceId: "t1",
        approvalRequest: { id: "ar1", bindingHash: "bh1" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCreateCreativeDraftRequest(), { wrapper });
    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        promoting: "Botox",
        goal: "more_bookings",
        vibe: "warm",
        mode: "polished",
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A parked brief is NOT a submitted draft: it must carry no jobId and flag
    // the approval-needed state so the desk can route the operator to approve.
    expect(outcome).toEqual({
      pendingApproval: true,
      approvalRequest: { id: "ar1", bindingHash: "bh1" },
    });
  });
});
