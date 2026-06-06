import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMiraDesk } from "../use-mira-desk";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({ miraFeed: { desk: () => ["org", "miraFeed", "desk"] } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useMiraDesk", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetches and returns the desk model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          desk: { inProduction: [], readyToReviewCount: 3, counts: {}, isEmpty: false },
        }),
      }),
    );
    const { result } = renderHook(() => useMiraDesk(), { wrapper });
    await waitFor(() => expect(result.current.data?.readyToReviewCount).toBe(3));
  });

  it("does not fetch when disabled (panel for a non-enabled org)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    renderHook(() => useMiraDesk(false), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
