import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "../route";

vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(),
}));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn(),
}));

import { getApiClient } from "@/lib/get-api-client";
import { requireDashboardSession } from "@/lib/require-dashboard-session";

describe("GET /api/dashboard/agents/[agentId]/pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards to client.listPipeline and returns the json body", async () => {
    const listPipeline = vi.fn().mockResolvedValue({ vm: { agentKey: "alex", tiles: [] } });
    (getApiClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ listPipeline });
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/dashboard/agents/alex/pipeline");
    const res = await GET(req, { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vm.agentKey).toBe("alex");
    expect(listPipeline).toHaveBeenCalledWith("alex");
  });

  it("returns 401 when session check throws Unauthorized", async () => {
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unauthorized"),
    );
    const req = new Request("http://localhost/api/dashboard/agents/alex/pipeline");
    const res = await GET(req, { params: Promise.resolve({ agentId: "alex" }) });
    expect(res.status).toBe(401);
  });
});
