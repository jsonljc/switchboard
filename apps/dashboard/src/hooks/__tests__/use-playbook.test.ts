import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("usePlaybook", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches and returns playbook data", async () => {
    const mockPlaybook = {
      playbook: {
        businessIdentity: {
          name: "Test Biz",
          status: "ready",
          source: "manual",
          category: "",
          tagline: "",
          location: "",
        },
        services: [],
        hours: {
          timezone: "",
          schedule: {},
          afterHoursBehavior: "",
          status: "missing",
          source: "manual",
        },
        bookingRules: { leadVsBooking: "", status: "missing", source: "manual" },
        approvalMode: { status: "missing", source: "manual" },
        escalation: { triggers: [], toneBoundaries: "", status: "missing", source: "manual" },
        channels: { configured: [], status: "missing", source: "manual" },
      },
      step: 1,
      complete: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlaybook),
    });

    const { usePlaybook } = await import("../use-playbook");
    const { result } = renderHook(() => usePlaybook(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.playbook.businessIdentity.name).toBe("Test Biz");
    expect(result.current.data?.step).toBe(1);
  });
});
