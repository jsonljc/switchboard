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

function makeReq(): Request {
  return new Request("http://x/api/dashboard/agents/alex/booking-wins");
}

describe("per-agent booking-wins dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("forwards to client.listBookingWins(agentId) and returns 200 with the payload", async () => {
    const listBookingWins = vi.fn().mockResolvedValue({
      vm: { wins: [], hasMore: false, freshness: { generatedAt: "x", dataSource: "live" } },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listBookingWins });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(listBookingWins).toHaveBeenCalledWith("alex");
    const body = await res.json();
    expect(body.vm.wins).toEqual([]);
  });

  it("maps an unknown upstream error to 500", async () => {
    const listBookingWins = vi.fn().mockRejectedValue(new Error("boom"));
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listBookingWins });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(500);
  });
});
