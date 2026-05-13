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

vi.mock("@/lib/route-availability", () => ({
  isMercuryToolLive: () => false,
}));

import { usePendingApprovals } from "../hooks/use-approvals";
import { APPROVALS_FIXTURES } from "../fixtures";

function wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePendingApprovals (fixture mode)", () => {
  it("returns the fixture rows projected to PendingApproval shape", async () => {
    const { result } = renderHook(() => usePendingApprovals(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.approvals).toHaveLength(APPROVALS_FIXTURES.length);
    // Confirm the projection: rich fields should NOT be present in the returned shape.
    const first = result.current.data?.approvals[0];
    expect(first).toBeDefined();
    expect(first).not.toHaveProperty("request");
    expect(first).not.toHaveProperty("recovery");
    expect(first).not.toHaveProperty("state");
    expect(first).not.toHaveProperty("patchProposal");
    // The bare wire fields should be present.
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("summary");
    expect(first).toHaveProperty("bindingHash");
    // The kept PendingApproval shape has 8 fields; we spot-check three here.
    // The remaining 5 (riskCategory, status, envelopeId, expiresAt, createdAt)
    // are guaranteed present by the typed PendingResponse — a missing required
    // field would fail typecheck before this test ran.
    expect(first).not.toHaveProperty("agent");
  });
});
