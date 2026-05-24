import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

// Provide scoped query keys so onSuccess invalidation does not crash.
vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    governance: {
      all: () => ["org-1", "governance"] as const,
      status: (id: string) => ["org-1", "governance", "status", id] as const,
    },
  }),
}));

import { useResume } from "../use-governance";

const wrap = () => {
  const c = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: c }, children);
};

describe("useResume", () => {
  it("surfaces readiness blockers on a 400 resume", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            resumed: false,
            readiness: {
              ready: false,
              checks: [
                {
                  id: "meta",
                  label: "Meta Ads",
                  status: "fail",
                  message: "Not connected",
                  blocking: true,
                },
              ],
            },
            statusCode: 400,
          }),
      }),
    );

    const { result } = renderHook(() => useResume(), { wrapper: wrap() });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toMatch(/Meta Ads/);
    expect(String(result.current.error)).toMatch(/Cannot resume — blockers/);
  });

  it("surfaces a generic error when readiness has no failed checks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            resumed: false,
            readiness: { ready: false, checks: [] },
            statusCode: 400,
          }),
      }),
    );

    const { result } = renderHook(() => useResume(), { wrapper: wrap() });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toMatch(/readiness checks did not pass/);
  });

  it("surfaces error.error field when no readiness is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
      }),
    );

    const { result } = renderHook(() => useResume(), { wrapper: wrap() });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toMatch(/Internal server error/);
  });

  it("resolves on a successful 200 resume", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ resumed: true, profile: "balanced" }),
      }),
    );

    const { result } = renderHook(() => useResume(), { wrapper: wrap() });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ resumed: true });
  });
});
