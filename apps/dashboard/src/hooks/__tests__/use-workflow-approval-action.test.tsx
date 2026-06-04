import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useWorkflowApprovalAction } from "../use-workflow-approval-action";

vi.mock("../use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    decisions: { all: () => ["org", "decisions"] },
    audit: { all: () => ["org", "audit"] },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useWorkflowApprovalAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs approve with lifecycleId + bindingHash + note and NO respondedBy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ approvalState: { status: "approved" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkflowApprovalAction("lc-1"), { wrapper });
    await act(async () => {
      await result.current.approve("hash-1", "looks right");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/approvals",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({
      approvalId: "lc-1",
      action: "approve",
      bindingHash: "hash-1",
      note: "looks right",
    });
    expect("respondedBy" in body).toBe(false);
  });

  it("POSTs reject without bindingHash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ approvalState: { status: "rejected" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkflowApprovalAction("lc-1"), { wrapper });
    await act(async () => {
      await result.current.reject();
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ approvalId: "lc-1", action: "reject" });
  });

  it("treats already_responded 409 as silent success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "already responded", code: "already_responded" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkflowApprovalAction("lc-1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.approve("h");
    });
    expect((out as { silent?: boolean }).silent).toBe(true);
  });

  it("flags stale_binding instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Stale binding", code: "stale_binding" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkflowApprovalAction("lc-1"), { wrapper });
    let out: unknown;
    await act(async () => {
      out = await result.current.approve("h");
    });
    expect((out as { staleBinding?: boolean }).staleBinding).toBe(true);
  });

  it("throws the server message on other errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Self-approval is not permitted", code: "self_approval" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkflowApprovalAction("lc-1"), { wrapper });
    await act(async () => {
      await expect(result.current.approve("h")).rejects.toThrow("Self-approval is not permitted");
    });
  });

  it("refuses approve without a bindingHash and never fetches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkflowApprovalAction("lc-1"), { wrapper });
    await act(async () => {
      await expect(result.current.approve("")).rejects.toThrow(/integrity record/);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
