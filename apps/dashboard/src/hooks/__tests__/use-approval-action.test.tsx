import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApprovalAction } from "../use-approval-action";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { principalId: "p-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useApprovalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts to /api/dashboard/approvals with action=approve on approve()", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "approved" }),
    });
    const { result } = renderHook(() => useApprovalAction("a-1"), { wrapper });
    await result.current.approve("hash-1");
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/dashboard/approvals",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"approve"'),
        }),
      );
    });
    const call = mockFetch.mock.calls[0]!;
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body).toMatchObject({
      approvalId: "a-1",
      action: "approve",
      bindingHash: "hash-1",
      respondedBy: "p-1",
    });
  });

  it("posts action=reject on reject()", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "rejected" }),
    });
    const { result } = renderHook(() => useApprovalAction("a-1"), { wrapper });
    await result.current.reject("hash-1");
    await waitFor(() => {
      const call = mockFetch.mock.calls[0]!;
      const body = JSON.parse((call[1] as { body: string }).body);
      expect(body).toMatchObject({
        approvalId: "a-1",
        action: "reject",
        bindingHash: "hash-1",
      });
    });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    const { result } = renderHook(() => useApprovalAction("a-1"), { wrapper });
    await expect(result.current.approve("hash-1")).rejects.toThrow();
  });
});
