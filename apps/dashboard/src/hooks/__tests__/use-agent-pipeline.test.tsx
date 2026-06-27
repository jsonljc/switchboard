import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgentPipeline } from "../use-agent-pipeline";

// Shared, overridable scoped-keys mock. `vi.hoisted` lets the same vi.fn be
// referenced from both the vi.mock factory and the test body, so a single test
// can flip the org scope to "unresolved" (null) and prove the query disables.
const { scopedKeysMock } = vi.hoisted(() => ({ scopedKeysMock: vi.fn() }));
vi.mock("../use-query-keys", () => ({ useScopedQueryKeys: scopedKeysMock }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  scopedKeysMock.mockReturnValue({
    pipeline: { feed: (agentKey: string) => ["org-test", "pipeline", "feed", agentKey] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAgentPipeline (live)", () => {
  it("unwraps json.vm on 200 and hits the agent-scoped pipeline URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ vm: { agentKey: "alex", totalCount: 7 } }),
    });
    const { result } = renderHook(() => useAgentPipeline("alex"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.totalCount).toBe(7);
    expect(result.current.data?.agentKey).toBe("alex");
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/pipeline");
  });

  it("surfaces isError + undefined data on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const { result } = renderHook(() => useAgentPipeline("alex"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("disables the query (no fetch) while the org scope is unresolved (keys null)", async () => {
    // useScopedQueryKeys() is null until the session resolves orgId; the hook is
    // enabled:!!keys, so it must NOT fetch (no cross-org/unscoped read) until then.
    scopedKeysMock.mockReturnValue(null);
    const { result } = renderHook(() => useAgentPipeline("alex"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
