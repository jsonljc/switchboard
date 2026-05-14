// apps/dashboard/src/app/api/dashboard/agents/[agentId]/mission/__tests__/route.test.ts
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

function makeReq(url = "http://x/api/dashboard/agents/alex/mission"): Request {
  return new Request(url);
}

describe("per-agent mission dashboard proxy", () => {
  it("returns 401 when no session", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });

  it("calls getMission(agentKey) and returns 200 with body", async () => {
    const getMission = vi.fn().mockResolvedValue({
      agentKey: "alex",
      displayName: "Alex",
      mission: {
        role: "SDR · qualify inbound leads, book tours",
        pipeline: "Tours pipeline · single funnel",
        brand: "Acme · —",
        channels: [],
        rules: null,
      },
      composerPlaceholder: "Tell Alex what to do — coming soon",
      commands: [],
      targets: { avgValueCents: null, targetCpbCents: null, roasSource: "deterministic" },
      setup: [
        { key: "meta", done: false, primary: true },
        { key: "inbox", done: false },
        { key: "cal", done: false },
        { key: "rules", done: false },
      ],
    });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getMission });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    expect(getMission).toHaveBeenCalledWith("alex");
    const body = (await res.json()) as { mission: { brand: string } };
    expect(body.mission.brand).toBe("Acme · —");
  });

  it("returns 500 when upstream throws", async () => {
    const getMission = vi.fn().mockRejectedValue(new Error("boom"));
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ getMission });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(500);
  });
});
