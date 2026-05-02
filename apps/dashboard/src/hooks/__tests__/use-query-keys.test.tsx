import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

const mockUseSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

// Wrapper isn't strictly needed because the hook does not use React Query,
// but keeping the shape consistent with other hook tests.
function wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe("useScopedQueryKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when session is null", async () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const { useScopedQueryKeys } = await import("@/hooks/use-query-keys");
    const { result } = renderHook(() => useScopedQueryKeys(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("returns null when session has no organizationId", async () => {
    mockUseSession.mockReturnValue({
      data: { principalId: "p-1" },
      status: "authenticated",
    });
    const { useScopedQueryKeys } = await import("@/hooks/use-query-keys");
    const { result } = renderHook(() => useScopedQueryKeys(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("returns scoped factory output when organizationId is set", async () => {
    mockUseSession.mockReturnValue({
      data: { organizationId: "org-1" },
      status: "authenticated",
    });
    const { useScopedQueryKeys } = await import("@/hooks/use-query-keys");
    const { result } = renderHook(() => useScopedQueryKeys(), { wrapper });
    expect(result.current?.dashboard.overview()).toEqual(["org-1", "dashboard", "overview"]);
    expect(result.current?.approvals.pending()).toEqual(["org-1", "approvals", "pending"]);
    expect(result.current?.identity.all()).toEqual(["org-1", "identity"]);
  });

  it("re-uses the same factory across renders for the same orgId", async () => {
    mockUseSession.mockReturnValue({
      data: { organizationId: "org-1" },
      status: "authenticated",
    });
    const { useScopedQueryKeys } = await import("@/hooks/use-query-keys");
    const { result, rerender } = renderHook(() => useScopedQueryKeys(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
