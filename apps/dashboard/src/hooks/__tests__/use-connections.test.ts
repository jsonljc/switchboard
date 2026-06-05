import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSetMetaPageId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PUTs the page id to the connection proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ connection: { id: "conn_1", updated: true } }),
    });
    const { useSetMetaPageId } = await import("@/hooks/use-connections");
    const { result } = renderHook(() => useSetMetaPageId(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ id: "conn_1", pageId: "123456789012345" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/connections/conn_1/meta-page-id",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ pageId: "123456789012345" }),
      }),
    );
  });

  it("throws the backend error message on failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Not a Meta Ads connection" }),
    });
    const { useSetMetaPageId } = await import("@/hooks/use-connections");
    const { result } = renderHook(() => useSetMetaPageId(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: "conn_1", pageId: "123456789012345" });
      }),
    ).rejects.toThrow("Not a Meta Ads connection");
  });
});
