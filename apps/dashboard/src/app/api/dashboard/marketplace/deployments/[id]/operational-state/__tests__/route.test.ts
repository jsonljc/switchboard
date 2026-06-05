import { describe, it, expect, vi, beforeEach } from "vitest";

const { recordOperationalState, getLatestOperationalState } = vi.hoisted(() => ({
  recordOperationalState: vi.fn(),
  getLatestOperationalState: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/require-dashboard-session", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ recordOperationalState, getLatestOperationalState }),
}));

import { GET, POST } from "../route";

const params = { params: Promise.resolve({ id: "dep_1" }) };

function postRequest(body: unknown) {
  return new Request(
    "http://localhost/api/dashboard/marketplace/deployments/dep_1/operational-state",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("operational-state proxy route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a note-only payload at the proxy (400) and never reaches the backend client", async () => {
    const res = await POST(postRequest({ note: "only a note" }) as never, params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toBeDefined();
    expect(recordOperationalState).not.toHaveBeenCalled();
  });

  it("rejects an empty payload at the proxy (400) and never reaches the backend client", async () => {
    const res = await POST(postRequest({}) as never, params);
    expect(res.status).toBe(400);
    expect(recordOperationalState).not.toHaveBeenCalled();
  });

  it("forwards a valid confirmation and returns 201 with the created row", async () => {
    recordOperationalState.mockResolvedValue({
      confirmation: { id: "osc_1", state: { staffing: "shortfall" } },
    });
    const res = await POST(postRequest({ staffing: "shortfall" }) as never, params);
    expect(res.status).toBe(201);
    expect(recordOperationalState).toHaveBeenCalledWith("dep_1", { staffing: "shortfall" });
  });

  it("GET passes honest absence through as { confirmation: null }", async () => {
    getLatestOperationalState.mockResolvedValue({ confirmation: null });
    const res = await GET(
      new Request(
        "http://localhost/api/dashboard/marketplace/deployments/dep_1/operational-state",
      ) as never,
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmation: null });
  });
});
