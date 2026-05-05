import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockGreetingResponse = {
  data: {
    variant: "named-lead",
    segments: [
      { kind: "text", text: "Three leads are waiting on you. " },
      { kind: "accent", text: "Maya" },
      { kind: "text", text: " is the one I'd answer first." },
    ],
    signal: { inboxCount: 3, oldestOpenItemAgeHours: 48, hoursSinceLastOperatorAction: 12 },
    freshness: { generatedAt: "2026-05-05T08:00:00.000Z", window: "today", dataSource: "live" },
  },
};

describe("useAgentGreeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns loading=true initially, then resolves with data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGreetingResponse),
    });

    const { useAgentGreeting } = await import("@/hooks/use-agent-greeting.js");
    const { result } = renderHook(() => useAgentGreeting("alex"), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.freshness.dataSource).toBe("live");
    expect(result.current.data?.signal.inboxCount).toBe(3);
  });

  it("calls the correct URL for alex", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGreetingResponse),
    });

    const { useAgentGreeting } = await import("@/hooks/use-agent-greeting.js");
    renderHook(() => useAgentGreeting("alex"), { wrapper: createWrapper() });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/alex/greeting");
  });

  it("calls the correct URL for riley", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGreetingResponse),
    });

    const { useAgentGreeting } = await import("@/hooks/use-agent-greeting.js");
    renderHook(() => useAgentGreeting("riley"), { wrapper: createWrapper() });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/riley/greeting");
  });

  it("sets isError and error on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { useAgentGreeting } = await import("@/hooks/use-agent-greeting.js");
    const { result } = renderHook(() => useAgentGreeting("alex"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toContain("Failed to load greeting: 500");
  });

  it("returns AgentBlockQuery shape with all four fields", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGreetingResponse),
    });

    const { useAgentGreeting } = await import("@/hooks/use-agent-greeting.js");
    const { result } = renderHook(() => useAgentGreeting("alex"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toHaveProperty("data");
    expect(result.current).toHaveProperty("isLoading");
    expect(result.current).toHaveProperty("isError");
    expect(result.current).toHaveProperty("error");
  });
});
