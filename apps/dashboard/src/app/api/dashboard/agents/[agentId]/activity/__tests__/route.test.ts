// apps/dashboard/src/app/api/dashboard/agents/[agentId]/activity/__tests__/route.test.ts
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

function makeReq(url = "http://x/api/dashboard/agents/alex/activity"): Request {
  return new Request(url);
}

describe("per-agent activity cockpit dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("calls getAgentActivityCockpit(agentId) and returns 200 with body", async () => {
    const mockRows = [
      {
        id: "t1",
        time: "11:58",
        kind: "booked",
        head: "Booked a tour with Jane",
        preview: null,
        threadId: null,
      },
    ];
    const getAgentActivityCockpit = vi.fn().mockResolvedValue({ rows: mockRows });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getAgentActivityCockpit,
    });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(getAgentActivityCockpit).toHaveBeenCalledWith("alex", {
      limit: undefined,
      expandPreview: true,
    });
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(1);
  });

  it("forwards limit and expandPreview query params", async () => {
    const getAgentActivityCockpit = vi.fn().mockResolvedValue({ rows: [] });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getAgentActivityCockpit,
    });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const req = makeReq("http://x/api/dashboard/agents/alex/activity?limit=5&expandPreview=false");
    const res = await GET(req, { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(getAgentActivityCockpit).toHaveBeenCalledWith("alex", {
      limit: 5,
      expandPreview: false,
    });
  });

  it("returns 500 when upstream throws", async () => {
    const getAgentActivityCockpit = vi.fn().mockRejectedValue(new Error("boom"));
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getAgentActivityCockpit,
    });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(500);
  });
});
