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

function makeReq(url = "http://x/api/dashboard/agents/alex/wins"): Request {
  return new Request(url);
}

describe("per-agent wins dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("calls listWins(agentKey, 'today') by default and returns 200 with body", async () => {
    const listWins = vi.fn().mockResolvedValue({
      vm: {
        wins: [],
        hasMore: false,
        freshness: { generatedAt: "x", window: "today", dataSource: "live" },
      },
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listWins });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(listWins).toHaveBeenCalledWith("alex", "today");
    const body = await res.json();
    expect(body.vm.wins).toEqual([]);
  });

  it("forwards window query param when present", async () => {
    const listWins = vi.fn().mockResolvedValue({ vm: { wins: [], hasMore: false } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listWins });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    await GET(makeReq("http://x/api/dashboard/agents/alex/wins?window=week"), {
      params: Promise.resolve({ agentId: "alex" }),
    });
    expect(listWins).toHaveBeenCalledWith("alex", "week");
  });

  it("rejects unknown window values with 400", async () => {
    const listWins = vi.fn().mockResolvedValue({ vm: {} });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listWins });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq("http://x/api/dashboard/agents/alex/wins?window=year"), {
      params: Promise.resolve({ agentId: "alex" }),
    });
    expect(res.status).toBe(400);
    expect(listWins).not.toHaveBeenCalled();
  });
});
