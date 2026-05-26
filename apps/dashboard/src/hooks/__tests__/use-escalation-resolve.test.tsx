import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";

const invalidateSpy = vi.fn();

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({
    escalations: { all: () => ["org_1", "escalations"] },
  }),
}));

import { useEscalationResolve } from "../use-escalation-resolve";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(client, "invalidateQueries").mockImplementation(invalidateSpy);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  invalidateSpy.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useEscalationResolve", () => {
  it("posts the resolutionNote and invalidates escalations on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ escalation: { id: "e1" } }) });
    const { result } = renderHook(() => useEscalationResolve("e1"), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.resolve("handled by phone");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/escalations/e1/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ resolutionNote: "handled by phone" }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org_1", "escalations"] });
  });

  it("sends an undefined note when none provided", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ escalation: { id: "e1" } }) });
    const { result } = renderHook(() => useEscalationResolve("e1"), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.resolve();
    });
    // `JSON.stringify({ resolutionNote: undefined })` drops the key → "{}".
    // Assert the literal wire body so the test isn't misleading about what's sent.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/escalations/e1/resolve",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("throws on non-ok", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useEscalationResolve("e1"), { wrapper: makeWrapper() });
    await expect(result.current.resolve("x")).rejects.toThrow();
  });
});
