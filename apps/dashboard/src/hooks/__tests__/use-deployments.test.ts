import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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

describe("useDeployments / useOrgDeploymentId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches deployments from the proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deployments: [{ id: "dep_1" }, { id: "dep_2" }] }),
    });
    const { useDeployments } = await import("@/hooks/use-deployments");
    const { result } = renderHook(() => useDeployments(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/marketplace/deployments");
    expect(result.current.data?.deployments).toHaveLength(2);
  });

  it("useOrgDeploymentId returns the first deployment id as the anchor", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deployments: [{ id: "dep_1" }, { id: "dep_2" }] }),
    });
    const { useOrgDeploymentId } = await import("@/hooks/use-deployments");
    const { result } = renderHook(() => useOrgDeploymentId(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.deploymentId).toBe("dep_1"));
  });

  it("useOrgDeploymentId returns null when the org has no deployments", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ deployments: [] }) });
    const { useOrgDeploymentId } = await import("@/hooks/use-deployments");
    const { result } = renderHook(() => useOrgDeploymentId(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.deploymentId).toBeNull();
  });
});
