import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
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

describe("useOperatorConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches operator config", async () => {
    const config = {
      id: "oc-1",
      active: true,
      automationLevel: "supervised",
      targets: { dailyBudgetCap: 33.33 },
      schedule: { optimizerCronHour: 6, reportCronHour: 8, timezone: "America/New_York" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ config }),
    });

    const { useOperatorConfig } = await import("@/hooks/use-operator-config");
    const { result } = renderHook(() => useOperatorConfig(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.config).toEqual(config);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/operator-config");
  });

  it("throws on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { useOperatorConfig } = await import("@/hooks/use-operator-config");
    const { result } = renderHook(() => useOperatorConfig(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useAutonomyAssessment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches autonomy assessment", async () => {
    const assessment = {
      currentProfile: "guarded",
      recommendedProfile: "observe",
      autonomousEligible: false,
      reason: "Need 20 more successes",
      progressPercent: 45,
      stats: {
        totalSuccesses: 30,
        totalFailures: 2,
        competenceScore: 72,
        failureRate: 0.06,
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ assessment }),
    });

    const { useAutonomyAssessment } = await import("@/hooks/use-operator-config");
    const { result } = renderHook(() => useAutonomyAssessment(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.assessment).toEqual(assessment);
    expect(result.current.data?.assessment.progressPercent).toBe(45);
  });
});

describe("useUpdateOperatorConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends PUT request with updates", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ config: { active: false } }),
    });

    const { useUpdateOperatorConfig } = await import("@/hooks/use-operator-config");
    const { result } = renderHook(() => useUpdateOperatorConfig(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ active: false });
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/operator-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
  });

  it("sends automation level update", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ config: { automationLevel: "autonomous" } }),
    });

    const { useUpdateOperatorConfig } = await import("@/hooks/use-operator-config");
    const { result } = renderHook(() => useUpdateOperatorConfig(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ automationLevel: "autonomous" });
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/operator-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ automationLevel: "autonomous" }),
    });
  });

  it("throws on update failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { useUpdateOperatorConfig } = await import("@/hooks/use-operator-config");
    const { result } = renderHook(() => useUpdateOperatorConfig(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ active: false });
      }),
    ).rejects.toThrow("Failed to update operator config");
  });
});
