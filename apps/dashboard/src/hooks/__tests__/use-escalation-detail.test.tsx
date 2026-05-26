import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    escalations: {
      all: () => ["org_1", "escalations"],
      detail: (id: string) => ["org_1", "escalations", "detail", id],
    },
  }),
}));

import { useEscalationDetail } from "../use-escalation-detail";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useEscalationDetail", () => {
  it("fetches the escalation detail proxy by id", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        escalation: { id: "esc_9", reason: "complex_objection", status: "pending" },
        conversationHistory: [{ role: "user", text: "Hi", timestamp: "2026-05-25T09:00:00Z" }],
      }),
    });

    const { result } = renderHook(() => useEscalationDetail("esc_9"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/escalations/esc_9");
    expect(result.current.data?.escalation.id).toBe("esc_9");
    expect(result.current.data?.conversationHistory).toHaveLength(1);
  });

  it("throws on non-ok so the sheet can render its error state", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useEscalationDetail("esc_err"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("is disabled when id is empty", () => {
    const { result } = renderHook(() => useEscalationDetail(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
