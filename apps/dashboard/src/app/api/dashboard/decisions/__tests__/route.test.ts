import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { GET } from "../route";

describe("decisions dashboard proxy (cross-agent)", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("calls listDecisions() with no agent scope and returns 200 with body", async () => {
    const listDecisions = vi.fn().mockResolvedValue({
      decisions: [{ id: "d1" }],
      counts: { total: 1, approval: 1, handoff: 0 },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listDecisions });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(listDecisions).toHaveBeenCalledWith();
    const body = await res.json();
    expect(body.decisions).toEqual([{ id: "d1" }]);
    expect(body.counts.total).toBe(1);
  });

  it("scopes to the user's org via the api client (which uses session-derived API key)", async () => {
    // The proxy enforces org scope by going through `getApiClient()` — that helper
    // resolves the session's org-scoped API key. This test verifies we call through
    // the helper instead of hitting the upstream API directly.
    const listDecisions = vi.fn().mockResolvedValue({
      decisions: [],
      counts: { total: 0, approval: 0, handoff: 0 },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listDecisions });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    await GET();
    expect(getApiClient).toHaveBeenCalled();
    expect(requireDashboardSession).toHaveBeenCalled();
  });
});
