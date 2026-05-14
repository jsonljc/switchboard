import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Use a mutable mock for useSession so we can test both shapes.
const mockSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockSession(),
}));

import { useSessionPrincipal } from "../hooks/use-session-principal";

describe("useSessionPrincipal", () => {
  it("returns principalId when session is present", () => {
    mockSession.mockReturnValue({
      data: { organizationId: "org-1", principalId: "p-42" },
      status: "authenticated",
    });
    const { result } = renderHook(() => useSessionPrincipal());
    expect(result.current).toBe("p-42");
  });

  it("returns null when session data is null", () => {
    mockSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const { result } = renderHook(() => useSessionPrincipal());
    expect(result.current).toBeNull();
  });

  it("returns null when session lacks principalId", () => {
    mockSession.mockReturnValue({
      data: { organizationId: "org-1" },
      status: "authenticated",
    });
    const { result } = renderHook(() => useSessionPrincipal());
    expect(result.current).toBeNull();
  });
});
