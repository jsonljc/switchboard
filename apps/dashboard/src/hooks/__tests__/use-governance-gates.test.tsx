import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    governance: {
      all: () => ["org-1", "governance"] as const,
      observeReview: (id: string) => ["org-1", "governance", "observe-review", id] as const,
      enforceReadiness: (id: string) => ["org-1", "governance", "enforce-readiness", id] as const,
    },
  }),
}));

import {
  useGovernanceObserveReview,
  useGovernanceEnforceReadiness,
  useSetGovernanceGateMode,
} from "../use-governance-gates";

const wrap = () => {
  const c = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: c }, children);
};

beforeEach(() => vi.unstubAllGlobals());

describe("use-governance-gates", () => {
  it("useGovernanceObserveReview fetches the proxy endpoint and returns data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ window: { since: "x" }, units: {}, samples: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGovernanceObserveReview("alex"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/governance/observe-review");
  });

  it("useGovernanceEnforceReadiness fetches the proxy endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ units: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGovernanceEnforceReadiness("alex"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/agents/alex/governance/enforce-readiness",
    );
  });

  it("useSetGovernanceGateMode POSTs the unit + mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unit: "deterministic", mode: "enforce" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSetGovernanceGateMode("alex"), { wrapper: wrap() });
    result.current.mutate({ unit: "deterministic", mode: "enforce" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/agents/alex/governance/gates/deterministic/mode",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "enforce" }) }),
    );
  });

  it("useSetGovernanceGateMode surfaces the server error code on a REFUSE", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "gate_not_enforce_ready" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSetGovernanceGateMode("alex"), { wrapper: wrap() });
    result.current.mutate({ unit: "deterministic", mode: "enforce" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(String(result.current.error)).toMatch(/gate_not_enforce_ready/);
  });
});
