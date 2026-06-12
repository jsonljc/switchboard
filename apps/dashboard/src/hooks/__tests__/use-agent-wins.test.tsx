import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Lazily-read mock so individual tests can flip keys to null (disabled path).
let keysValue: unknown = {
  bookingWins: { feed: (k: string) => ["test", "bookingWins", "feed", k] as const },
};
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => keysValue,
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  keysValue = { bookingWins: { feed: (k: string) => ["test", "bookingWins", "feed", k] as const } };
});

import { useAgentWins } from "../use-agent-wins";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAgentWins", () => {
  it("fetches the booking-wins endpoint and unwraps the vm envelope", async () => {
    const vm = {
      wins: [
        {
          traceId: "t1",
          bookingId: "b1",
          contactId: "c1",
          service: "botox",
          bookingStatus: "confirmed",
          valueCents: 45000,
          revenuePending: false,
          sourceCampaignId: "camp",
          timeFolio: "9:00 AM",
          occurredAtIso: "2026-06-12T03:00:00Z",
        },
      ],
      hasMore: false,
      freshness: { generatedAt: "x", dataSource: "live" },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ vm }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/booking-wins");
    expect(result.current.data!.wins[0]!.traceId).toBe("t1");
    expect(result.current.data!.wins[0]!.valueCents).toBe(45000);
  });

  it("surfaces an error when the fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("is disabled (no fetch, data undefined) when keys are null", () => {
    keysValue = null;
    const { result } = renderHook(() => useAgentWins("alex"), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
