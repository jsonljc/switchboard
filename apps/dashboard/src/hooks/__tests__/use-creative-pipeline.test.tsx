import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApproveStage } from "../use-creative-pipeline";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({ creativeJobs: { all: () => ["org", "creativeJobs"] } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useApproveStage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the completed job + action on a normal approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ job: { id: "j1" }, action: "approved" }),
      }),
    );
    const { result } = renderHook(() => useApproveStage(), { wrapper });
    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        jobId: "j1",
        action: "continue",
        productionTier: "pro",
      });
    });
    expect(data).toEqual({ pendingApproval: false, job: { id: "j1" }, action: "approved" });
  });

  it("surfaces a PENDING_APPROVAL envelope as a pending-approval result (not a phantom completion)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({
          outcome: "PENDING_APPROVAL",
          workUnitId: "wu1",
          traceId: "t1",
          approvalRequest: { id: "lc1", bindingHash: "bh1" },
        }),
      }),
    );
    const { result } = renderHook(() => useApproveStage(), { wrapper });
    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({
        jobId: "j1",
        action: "continue",
        productionTier: "pro",
      });
    });
    expect(data).toEqual({
      pendingApproval: true,
      approvalRequest: { id: "lc1", bindingHash: "bh1" },
    });
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );
    const { result } = renderHook(() => useApproveStage(), { wrapper });
    await expect(result.current.mutateAsync({ jobId: "j1", action: "continue" })).rejects.toThrow();
  });
});
