import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const patchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/get-api-client", () => ({
  getApiClient: vi.fn().mockResolvedValue({ patchOpportunityStage: patchMock }),
}));

import { PATCH } from "../route";
import { requireSession } from "@/lib/session";

function mkReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/dashboard/opportunities/opp_1/stage", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/dashboard/opportunities/:id/stage (proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchMock.mockReset();
  });

  it("forwards { stage } to client.patchOpportunityStage(id, stage)", async () => {
    patchMock.mockResolvedValueOnce({ opportunity: { id: "opp_1", stage: "booked" } });
    const res = await PATCH(mkReq({ stage: "booked" }), {
      params: Promise.resolve({ id: "opp_1" }),
    });
    expect(patchMock).toHaveBeenCalledWith("opp_1", "booked");
    expect(res.status).toBe(200);
  });

  it("returns 401 on Unauthorized", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await PATCH(mkReq({ stage: "booked" }), {
      params: Promise.resolve({ id: "opp_1" }),
    });
    expect(res.status).toBe(401);
  });

  it("maps upstream 'not found' to 404", async () => {
    patchMock.mockRejectedValueOnce(new Error("not found"));
    const res = await PATCH(mkReq({ stage: "booked" }), {
      params: Promise.resolve({ id: "opp_x" }),
    });
    expect(res.status).toBe(404);
  });

  it("maps upstream 'invalid' to 400", async () => {
    patchMock.mockRejectedValueOnce(new Error("invalid stage"));
    const res = await PATCH(mkReq({ stage: "garbage" }), {
      params: Promise.resolve({ id: "opp_1" }),
    });
    expect(res.status).toBe(400);
  });
});
