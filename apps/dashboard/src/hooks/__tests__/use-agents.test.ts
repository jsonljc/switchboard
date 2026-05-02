import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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

describe("useAgentRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches agent roster", async () => {
    const roster = [
      {
        id: "a1",
        agentRole: "primary_operator",
        displayName: "Ava",
        status: "active",
        tier: "starter",
      },
      { id: "a2", agentRole: "monitor", displayName: "Monitor", status: "active", tier: "starter" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ roster }),
    });

    const { useAgentRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useAgentRoster(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.roster).toEqual(roster);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/roster");
  });

  it("handles fetch errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { useAgentRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useAgentRoster(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useAgentState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches agent state", async () => {
    const states = [
      { agentRole: "primary_operator", activityStatus: "idle", currentTask: null },
      {
        agentRole: "monitor",
        activityStatus: "working",
        currentTask: "Monitoring ad performance",
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ states }),
    });

    const { useAgentState } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useAgentState(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.states).toEqual(states);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/state");
  });
});

describe("useUpdateAgentRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates an agent roster entry", async () => {
    const updatedAgent = {
      id: "a1",
      agentRole: "primary_operator",
      displayName: "Nova",
      status: "active",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ agent: updatedAgent }),
    });

    const { useUpdateAgentRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useUpdateAgentRoster(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: "a1", displayName: "Nova" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/roster/a1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Nova" }),
    });
  });

  it("handles update errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Agent not found" }),
    });

    const { useUpdateAgentRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useUpdateAgentRoster(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: "bad-id", displayName: "Test" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Agent not found");
  });
});

describe("useInitializeRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes roster with default values", async () => {
    const roster = [
      { id: "a1", agentRole: "primary_operator", displayName: "Ava", status: "active" },
      { id: "a2", agentRole: "monitor", displayName: "Monitor", status: "active" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ roster }),
    });

    const { useInitializeRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useInitializeRoster(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("initializes roster with custom operator name", async () => {
    const roster = [
      { id: "a1", agentRole: "primary_operator", displayName: "Nova", status: "active" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ roster }),
    });

    const { useInitializeRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useInitializeRoster(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        operatorName: "Nova",
        operatorConfig: { tone: "concise", workingStyle: "Concise & Direct" },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/agents/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operatorName: "Nova",
        operatorConfig: { tone: "concise", workingStyle: "Concise & Direct" },
      }),
    });
  });

  it("returns alreadyInitialized flag when roster exists", async () => {
    const roster = [
      { id: "a1", agentRole: "primary_operator", displayName: "Ava", status: "active" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ roster, alreadyInitialized: true }),
    });

    const { useInitializeRoster } = await import("@/hooks/use-agents");
    const { result } = renderHook(() => useInitializeRoster(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.alreadyInitialized).toBe(true);
  });
});
