// apps/dashboard/src/hooks/__tests__/use-agent-mission.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    mission: { detail: (k: string) => ["test", "mission", k] as const },
  }),
}));

let mockHalted = false;
const haltSubscribers = new Set<() => void>();
function setMockHalted(v: boolean) {
  mockHalted = v;
  haltSubscribers.forEach((cb) => cb());
}

vi.mock("@/components/layout/halt/halt-context", () => ({
  useHalt: () => {
    const [, setTick] = useState(0);
    useEffect(() => {
      const cb = () => setTick((t) => t + 1);
      haltSubscribers.add(cb);
      return () => {
        haltSubscribers.delete(cb);
      };
    }, []);
    return { halted: mockHalted, setHalted: vi.fn() };
  },
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  mockHalted = false;
  haltSubscribers.clear();
});

import { useAgentMission } from "../use-agent-mission";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAgentMission", () => {
  it("fetches the per-agent mission endpoint and surfaces data", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          agentKey: "alex",
          displayName: "Alex",
          mission: { role: "x", pipeline: "y", brand: "z", channels: [], rules: null },
          composerPlaceholder: "",
          commands: [],
          targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
          setup: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { result } = renderHook(() => useAgentMission("alex"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data?.agentKey).toBe("alex"));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/agents/alex/mission");
  });

  it("surfaces error when the fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useAgentMission("alex"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("refetches when halted flag toggles (query key changes)", async () => {
    // First fetch: halted=false → displayName "Alex-Live"
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          agentKey: "alex",
          displayName: "Alex-Live",
          mission: { role: "x", pipeline: "y", brand: "z", channels: [], rules: null },
          composerPlaceholder: "",
          commands: [],
          targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
          setup: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    // Second fetch: halted=true → displayName "Alex-Halted"
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          agentKey: "alex",
          displayName: "Alex-Halted",
          mission: { role: "x", pipeline: "y", brand: "z", channels: [], rules: null },
          composerPlaceholder: "",
          commands: [],
          targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
          setup: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useAgentMission("alex"), { wrapper: makeWrapper() });

    // Wait for the first fetch to complete (halted=false key)
    await waitFor(() => expect(result.current.data?.displayName).toBe("Alex-Live"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Toggle halted → triggers subscriber → hook re-renders with new query key
    act(() => {
      setMockHalted(true);
    });

    // Wait for the second fetch to complete (halted=true key)
    await waitFor(() => expect(result.current.data?.displayName).toBe("Alex-Halted"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
