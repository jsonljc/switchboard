import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn(async () => ({ user: { id: "u1" } })),
}));

const listMetrics = vi.fn();
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn(async () => ({ listMetrics })),
}));

import { GET } from "../route";

beforeEach(() => {
  listMetrics.mockReset();
});

function buildRequest(url: string): Request {
  return new Request(url);
}

function buildParams(agentId: string) {
  return Promise.resolve({ agentId });
}

describe("metrics proxy", () => {
  it("400 for window=today", async () => {
    const res = await GET(
      buildRequest("http://localhost/api/dashboard/agents/alex/metrics?window=today"),
      { params: buildParams("alex") },
    );
    expect(res.status).toBe(400);
  });

  it("200 passthrough for window=week", async () => {
    listMetrics.mockResolvedValueOnce({ vm: { hero: { kind: "appointments-booked" } } });
    const res = await GET(
      buildRequest("http://localhost/api/dashboard/agents/alex/metrics?window=week"),
      { params: buildParams("alex") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vm.hero.kind).toBe("appointments-booked");
    expect(listMetrics).toHaveBeenCalledWith("alex", "week");
  });

  it("default window is week when query absent", async () => {
    listMetrics.mockResolvedValueOnce({ vm: {} });
    await GET(buildRequest("http://localhost/api/dashboard/agents/alex/metrics"), {
      params: buildParams("alex"),
    });
    expect(listMetrics).toHaveBeenCalledWith("alex", "week");
  });

  it("401 when session is unauthorized", async () => {
    const { requireDashboardSession } = await import("@/lib/require-dashboard-session");
    (requireDashboardSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized"),
    );
    const res = await GET(
      buildRequest("http://localhost/api/dashboard/agents/alex/metrics?window=week"),
      { params: buildParams("alex") },
    );
    expect(res.status).toBe(401);
  });

  it("500 when upstream throws", async () => {
    listMetrics.mockRejectedValueOnce(new Error("upstream boom"));
    const res = await GET(
      buildRequest("http://localhost/api/dashboard/agents/alex/metrics?window=week"),
      { params: buildParams("alex") },
    );
    expect(res.status).toBe(500);
  });
});
