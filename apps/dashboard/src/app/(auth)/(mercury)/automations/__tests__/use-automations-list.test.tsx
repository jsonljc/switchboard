import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useAutomationsList } from "../hooks/use-automations-list";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    automations: { list: (q: object) => ["org-test", "automations", "list", q] as const },
  }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAutomationsList", () => {
  const ORIG_LIVE = process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = ORIG_LIVE;
  });

  it("returns the fixture page when NEXT_PUBLIC_AUTOMATIONS_LIVE !== 'true'", async () => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "false";
    const { result } = renderHook(() => useAutomationsList({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]).toEqual(AUTOMATIONS_FIXTURE_PAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls /api/dashboard/automations when live and validates the response", async () => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "true";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => AUTOMATIONS_FIXTURE_PAGE,
    } as Response);

    const { result } = renderHook(() => useAutomationsList({ status: "active" }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/automations?status=active"),
    );
  });

  it("throws when the response shape is invalid", async () => {
    process.env.NEXT_PUBLIC_AUTOMATIONS_LIVE = "true";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rows: "not-an-array" }),
    } as Response);

    const { result } = renderHook(() => useAutomationsList({}), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
