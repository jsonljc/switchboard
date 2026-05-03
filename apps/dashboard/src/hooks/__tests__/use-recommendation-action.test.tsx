import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { useRecommendationAction } from "../use-recommendation-action.js";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1", principalId: "user-1" } }),
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as never;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => fetchMock.mockReset());

describe("useRecommendationAction", () => {
  it.each([["primary"], ["secondary"], ["dismiss"], ["confirm"], ["undo"]])(
    "calls POST with action=%s",
    async (action) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ recommendation: {} }),
      });
      const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
      await act(async () => {
        await result.current[action as keyof typeof result.current]?.call(result.current);
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/dashboard/recommendations",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`"action":"${action}"`),
        }),
      );
    },
  );

  it("treats 409 as silent success (does not throw)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "already_terminal" }),
    });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    let threw = false;
    await act(async () => {
      try {
        await result.current.primary();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });

  it("non-409 errors throw", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "boom" }),
    });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    let threw: unknown = null;
    await act(async () => {
      try {
        await result.current.primary();
      } catch (e) {
        threw = e;
      }
    });
    expect(threw).toBeInstanceOf(Error);
  });

  it("includes note in body when provided", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ recommendation: {} }),
    });
    const { result } = renderHook(() => useRecommendationAction("r-1"), { wrapper });
    await act(async () => {
      await result.current.primary("operator-note");
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('"note":"operator-note"');
  });
});
