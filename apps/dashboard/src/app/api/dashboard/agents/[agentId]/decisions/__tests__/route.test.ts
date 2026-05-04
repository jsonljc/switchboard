import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue(undefined),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";
import { GET } from "../route.js";

function makeReq(): Request {
  return new Request("http://x/api/dashboard/agents/alex/decisions");
}

describe("per-agent decisions dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("calls listDecisions(agentKey) with the route param and returns 200 with body", async () => {
    const listDecisions = vi.fn().mockResolvedValue({
      decisions: [{ id: "d1", agentKey: "alex" }],
      counts: { total: 1, approval: 0, handoff: 1 },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listDecisions });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(listDecisions).toHaveBeenCalledWith("alex");
    const body = await res.json();
    expect(body.decisions[0].id).toBe("d1");
    expect(body.counts.handoff).toBe(1);
  });

  it("scopes to the user's org via the api client (session-derived API key)", async () => {
    const listDecisions = vi.fn().mockResolvedValue({
      decisions: [],
      counts: { total: 0, approval: 0, handoff: 0 },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listDecisions });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    await GET(makeReq(), { params: Promise.resolve({ agentId: "riley" }) });
    expect(getApiClient).toHaveBeenCalled();
    expect(requireDashboardSession).toHaveBeenCalled();
  });
});
