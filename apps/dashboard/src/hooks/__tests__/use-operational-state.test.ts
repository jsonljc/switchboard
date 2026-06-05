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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const WIRE_CONFIRMATION = {
  id: "osc_1",
  organizationId: "org-1",
  state: { staffing: "shortfall" },
  confirmedBy: "principal-7",
  confirmedAt: "2026-06-05T02:00:00.000Z",
  createdAt: "2026-06-05T02:00:00.000Z",
};

describe("useOperationalState / useRecordOperationalState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads { confirmation } from the proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ confirmation: WIRE_CONFIRMATION }),
    });
    const { useOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/operational-state",
    );
    expect(result.current.data?.confirmation?.state).toEqual({ staffing: "shortfall" });
  });

  it("reads honest absence ({ confirmation: null }) without fabricating a default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ confirmation: null }),
    });
    const { useOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.confirmation).toBeNull();
  });

  it("is disabled (no fetch) when deploymentId is null", async () => {
    const { useOperationalState } = await import("@/hooks/use-operational-state");
    renderHook(() => useOperationalState(null), { wrapper: createWrapper() });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("POSTs the state and surfaces 400 details as OperationalStateValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 400,
      ok: false,
      json: () => Promise.resolve({ error: "Validation failed", details: { formErrors: [] } }),
    });
    const { useRecordOperationalState, OperationalStateValidationError } =
      await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useRecordOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ note: "only a note" })).rejects.toBeInstanceOf(
        OperationalStateValidationError,
      );
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/operational-state",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "only a note" }) }),
    );
  });

  it("POST success resolves with the created confirmation", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ confirmation: WIRE_CONFIRMATION }),
    });
    const { useRecordOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useRecordOperationalState("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      const out = await result.current.mutateAsync({ staffing: "shortfall" });
      expect(out.confirmation.id).toBe("osc_1");
    });
  });

  it("does not POST when deploymentId is null (fails locally before fetch)", async () => {
    const { useRecordOperationalState } = await import("@/hooks/use-operational-state");
    const { result } = renderHook(() => useRecordOperationalState(null), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ staffing: "shortfall" })).rejects.toThrow(
        /deploymentId/i,
      );
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
