import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgentActivityCockpit } from "../use-agent-activity-cockpit";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: vi.fn(() => ({
    agents: {
      activityCockpit: (agentId: string) => ["org-test", "agents", "activity-cockpit", agentId],
    },
  })),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAgentActivityCockpit", () => {
  it("calls /api/dashboard/agents/[agentId]/activity and returns rows", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [{ id: "a1", time: "11:58", kind: "booked", head: "Maya confirmed Pilates Sat 2pm" }],
      }),
    });
    const { result } = renderHook(() => useAgentActivityCockpit("alex"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/dashboard/agents/alex/activity");
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("encodes expandPreview=false when caller passes it", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
    renderHook(() => useAgentActivityCockpit("alex", { expandPreview: false }), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("expandPreview=false");
  });

  it("throws on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const { result } = renderHook(() => useAgentActivityCockpit("alex"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
