import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => true }));

import { useRespondToApproval } from "../use-approvals";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrap({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useRespondToApproval", () => {
  it("POSTs approve with bindingHash and respondedBy from session", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ envelope: {}, approvalState: {}, executionResult: {} }),
    });
    const qc = makeClient();
    const { result } = renderHook(() => useRespondToApproval(), {
      wrapper: ({ children }) => wrap({ children, qc }),
    });
    result.current.mutate({ id: "apr_1", action: "approve", bindingHash: "0xabc" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/dashboard/approvals");
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({
      approvalId: "apr_1",
      action: "approve",
      bindingHash: "0xabc",
      respondedBy: "p-1",
    });
  });

  it("POSTs reject WITHOUT bindingHash", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const qc = makeClient();
    const { result } = renderHook(() => useRespondToApproval(), {
      wrapper: ({ children }) => wrap({ children, qc }),
    });
    result.current.mutate({ id: "apr_1", action: "reject" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ approvalId: "apr_1", action: "reject", respondedBy: "p-1" });
    expect(body).not.toHaveProperty("bindingHash");
  });

  it("POSTs patch with both bindingHash AND patchValue", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const qc = makeClient();
    const { result } = renderHook(() => useRespondToApproval(), {
      wrapper: ({ children }) => wrap({ children, qc }),
    });
    result.current.mutate({
      id: "apr_1",
      action: "patch",
      bindingHash: "0xabc",
      patchValue: { discountPct: 25 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.bindingHash).toBe("0xabc");
    expect(body.patchValue).toEqual({ discountPct: 25 });
  });

  it("surfaces a typed conflict on 409", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "stale", statusCode: 409 }),
    });
    const qc = makeClient();
    const { result } = renderHook(() => useRespondToApproval(), {
      wrapper: ({ children }) => wrap({ children, qc }),
    });
    result.current.mutate({ id: "apr_1", action: "approve", bindingHash: "0xabc" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error & { status?: number }).status).toBe(409);
  });

  it("invalidates approvals AND decisions caches on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const qc = makeClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRespondToApproval(), {
      wrapper: ({ children }) => wrap({ children, qc }),
    });
    result.current.mutate({ id: "apr_1", action: "approve", bindingHash: "0xabc" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
    expect(calls.some((k) => k.includes("approvals"))).toBe(true);
    expect(calls.some((k) => k.includes("decisions"))).toBe(true);
  });
});
