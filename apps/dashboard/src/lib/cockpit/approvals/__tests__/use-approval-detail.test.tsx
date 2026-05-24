import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));

import { useApprovalDetail } from "../use-approvals";

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useApprovalDetail (fixture mode)", () => {
  it("returns the rich DetailRow for a known id", async () => {
    const { result } = renderHook(() => useApprovalDetail("apr_2f1a08"), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.id).toBe("apr_2f1a08"));
    // Detail mode keeps the rich fields stripped in the queue projection.
    expect(result.current.data?.agent).toBe("billing-agent");
    expect(result.current.data?.request?.parametersSnapshot).toBeDefined();
  });

  it("is disabled when id is null", () => {
    const { result } = renderHook(() => useApprovalDetail(null), { wrapper: wrap });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});
