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

describe("useBusinessFacts / useUpsertBusinessFacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads {facts,status} from the proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ facts: { businessName: "Glow" }, status: "present" }),
    });
    const { useBusinessFacts } = await import("@/hooks/use-business-facts");
    const { result } = renderHook(() => useBusinessFacts("dep_1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/business-facts",
    );
    expect(result.current.data?.status).toBe("present");
  });

  it("is disabled (no fetch) when deploymentId is null", async () => {
    const { useBusinessFacts } = await import("@/hooks/use-business-facts");
    renderHook(() => useBusinessFacts(null), { wrapper: createWrapper() });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("PUTs facts and surfaces 400 details as BusinessFactsValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 400,
      ok: false,
      json: () => Promise.resolve({ error: "Validation failed", details: { fieldErrors: {} } }),
    });
    const { useUpsertBusinessFacts, BusinessFactsValidationError } =
      await import("@/hooks/use-business-facts");
    const { result } = renderHook(() => useUpsertBusinessFacts("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      result.current.mutate({ businessName: "X" } as never);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(BusinessFactsValidationError);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/business-facts",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("PUT success resolves", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
    const { useUpsertBusinessFacts } = await import("@/hooks/use-business-facts");
    const { result } = renderHook(() => useUpsertBusinessFacts("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      result.current.mutate({ businessName: "Glow" } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
