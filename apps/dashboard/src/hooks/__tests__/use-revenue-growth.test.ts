import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useDiagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches latest diagnostic data", async () => {
    const diagnostic = {
      cycleId: "cycle_1",
      dataTier: "FULL",
      scorerOutputs: [{ constraintType: "SIGNAL", score: 72, confidence: "HIGH" }],
      primaryConstraint: { type: "CREATIVE", score: 45, confidence: "HIGH" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: diagnostic }),
    });

    const { useDiagnostic } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useDiagnostic("act_123"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.cycleId).toBe("cycle_1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/revenue-growth/diagnostic?accountId=act_123"),
    );
  });

  it("returns null when no diagnostic exists", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: null }),
    });

    const { useDiagnostic } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useDiagnostic("act_123"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when accountId is undefined", async () => {
    const { useDiagnostic } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useDiagnostic(undefined), { wrapper: createWrapper() });

    // Should not fetch — query stays in idle state
    expect(result.current.isFetching).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("useConnectorStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches connector status", async () => {
    const connectors = [{ connectorId: "meta-ads", name: "Meta Ads", status: "connected" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ connectors }),
    });

    const { useConnectorStatus } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useConnectorStatus("act_123"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].status).toBe("connected");
  });
});

describe("useInterventions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches intervention list", async () => {
    const interventions = [{ id: "int_1", actionType: "REFRESH_CREATIVE", status: "PROPOSED" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ interventions }),
    });

    const { useInterventions } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useInterventions("act_123"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useRunDiagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts diagnostic run request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ outcome: "executed", data: {} }),
    });

    const { useRunDiagnostic } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useRunDiagnostic(), { wrapper: createWrapper() });

    result.current.mutate("act_123");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/revenue-growth/diagnostic",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("useDigest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches weekly digest", async () => {
    const digest = {
      id: "digest_1",
      headline: "Creative fatigue easing",
      summary: "Summary text",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ digest }),
    });

    const { useDigest } = await import("@/hooks/use-revenue-growth");
    const { result } = renderHook(() => useDigest("act_123"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.headline).toBe("Creative fatigue easing");
  });
});
