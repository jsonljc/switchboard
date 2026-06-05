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

  it("sends an Idempotency-Key header and returns the contract", async () => {
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
    await act(async () => {
      await result.current.mutateAsync({
        promoting: "Botox",
        goal: "more_bookings",
        vibe: "warm",
        mode: "polished",
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });
});
