import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEscalationReply } from "../use-escalation-reply";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useEscalationReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts message to /api/dashboard/escalations/:id/reply and returns { ok: true } on 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        escalation: { id: "e-1", status: "released" },
        replySent: true,
      }),
    });
    const { result } = renderHook(() => useEscalationReply("e-1"), { wrapper });
    const out = await result.current.send("hello");
    expect(out.ok).toBe(true);
    expect(out.escalation).toMatchObject({ id: "e-1" });

    const call = mockFetch.mock.calls[0]!;
    expect(call[0]).toBe("/api/dashboard/escalations/e-1/reply");
    const init = call[1] as { method: string; body: string };
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ message: "hello" });
  });

  it("returns { ok: false, error } on 502 proactive-delivery failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        escalation: { id: "e-1", status: "released" },
        replySent: false,
        error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
        statusCode: 502,
      }),
    });
    const { result } = renderHook(() => useEscalationReply("e-1"), { wrapper });
    const out = await result.current.send("hello");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("channel delivery failed");
    expect(out.escalation).toMatchObject({ id: "e-1" });
  });

  it("throws on non-200/502 (true server error)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal" }),
    });
    const { result } = renderHook(() => useEscalationReply("e-1"), { wrapper });
    await expect(result.current.send("hello")).rejects.toThrow();
  });
});
